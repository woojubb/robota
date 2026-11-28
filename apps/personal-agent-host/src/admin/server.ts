import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { AuditLog } from '../audit.js';
import type { ControlPlane } from '../control-plane.js';
import { errorMessage, HostError } from '../errors.js';
import { HTTP_STATUS, type IAdminErrorBody, MAX_BODY_BYTES, TAR_TYPE } from './protocol.js';

const ACTOR = 'operator';
const ROUTE_ID = /^[a-z0-9-]{1,63}$/u;
const ACTIONS = [
  'suspend',
  'resume',
  'access-code',
  'upgrade',
  'delete',
  'backup',
  'restore',
] as const;
type Action = (typeof ACTIONS)[number];

/** A request rejected before it became a command; the HTTP status says which kind. */
class RequestError extends HostError {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super('bad-request', message);
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Names a rejected field only when it is a plain word, so a body can never echo itself back. */
function plainName(name: string): string {
  return /^[A-Za-z0-9_]{1,40}$/u.test(name) ? `"${name}"` : 'a field';
}

function exact(
  body: Json,
  where: string,
  required: readonly string[],
  optional: readonly string[],
) {
  for (const name of Object.keys(body)) {
    if (!required.includes(name) && !optional.includes(name)) {
      throw new RequestError(`${where} has an unknown field: ${plainName(name)}`);
    }
  }
  for (const name of required) {
    if (!(name in body)) throw new RequestError(`${where} needs the field "${name}"`);
  }
}

function object(value: unknown, where: string): Json {
  if (!isObject(value)) throw new RequestError(`${where} must be a JSON object`);
  return value;
}

function text(body: Json, name: string): string {
  const value = body[name];
  if (typeof value !== 'string') throw new RequestError(`"${name}" must be a string`);
  return value;
}

async function readJson(req: IncomingMessage, allowed: boolean): Promise<Json | undefined> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new RequestError('The request body is too large', 413);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RequestError('The request body is too large', 413);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return undefined;
  if (!allowed) throw new RequestError('This request takes no body');
  if (!/^application\/json(?:\s*;.*)?$/iu.test(req.headers['content-type'] ?? '')) {
    throw new RequestError('The request body must be application/json', 415);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // The parser's own message quotes the text it choked on, which could be a model key.
    throw new RequestError('The request body is not valid JSON');
  }
  return object(parsed, 'The request body');
}

function addInput(body: Json) {
  exact(body, 'The account', ['id', 'backend', 'provider', 'keySource'], ['apiKey', 'limits']);
  const provider = object(body.provider, 'The provider');
  exact(provider, 'The provider', ['type'], ['model', 'baseUrl']);
  const limits = body.limits === undefined ? undefined : object(body.limits, 'The limits');
  if (limits) exact(limits, 'The limits', [], ['memoryMb', 'cpus', 'pids']);
  const id = text(body, 'id');
  if (id.length > 63) throw new RequestError('"id" is too long');
  return {
    id,
    backend: text(body, 'backend') as 'container' | 'vm',
    provider: provider as { type: string; model?: string; baseUrl?: string },
    keySource: text(body, 'keySource') as 'account' | 'operator' | 'none',
    ...(body.apiKey !== undefined ? { apiKey: text(body, 'apiKey') } : {}),
    ...(limits ? { limits: limits as { memoryMb?: number; cpus?: number; pids?: number } } : {}),
  };
}

interface IRoute {
  /** Whether the route reads a JSON body. */
  body: boolean;
  run(body: Json | undefined): Promise<unknown>;
  /** A route that streams bytes owns its request and response; the others answer with JSON. */
  raw?(req: IncomingMessage, res: ServerResponse, begin: () => void): Promise<void>;
  /** The query parameters the route reads; any other route refuses a query string. */
  query?: readonly string[];
}

/** Reads the one flag restore takes: `from-other-account=true`, nothing else. */
function restoreFlags(search: URLSearchParams): { fromOtherAccount: boolean } {
  let fromOtherAccount = false;
  for (const [name, value] of search) {
    if (name !== 'from-other-account' || value !== 'true') {
      throw new RequestError('The only query parameter restore takes is from-other-account=true');
    }
    fromOtherAccount = true;
  }
  return { fromOtherAccount };
}

function route(
  plane: ControlPlane,
  audit: AuditLog,
  method: string,
  path: string,
  search: URLSearchParams,
): IRoute {
  const parts = path.split('/').filter((part, index) => index > 0 || part !== '');
  if (parts[0] !== 'v1') throw new RequestError('No such route', 404);
  const [, collection, id, action, ...rest] = parts;
  if (rest.length > 0) throw new RequestError('No such route', 404);
  const wrongMethod = (): never => {
    throw new RequestError(`${method} is not allowed here`, 405);
  };

  if (collection === 'status' && id === undefined) {
    if (method !== 'GET') wrongMethod();
    return { body: false, run: () => plane.status(ACTOR) };
  }
  if (collection === 'health' && id === undefined) {
    if (method !== 'GET') wrongMethod();
    return { body: false, run: () => plane.health(ACTOR) };
  }
  if (collection === 'upgrade' && id === undefined) {
    if (method !== 'POST') wrongMethod();
    return {
      body: true,
      run: (b) => {
        noParameters(b);
        return plane.upgrade({ all: true }, ACTOR);
      },
    };
  }
  if (collection !== 'accounts') throw new RequestError('No such route', 404);
  if (id === undefined) {
    if (method === 'GET') return { body: false, run: () => plane.list(ACTOR) };
    if (method === 'POST') {
      return {
        body: true,
        run: (body) => {
          if (!body) throw new RequestError('Adding an account needs a JSON body');
          return plane.add(addInput(body), ACTOR);
        },
      };
    }
    return wrongMethod();
  }
  if (!ROUTE_ID.test(id)) throw new RequestError('The account id in the path is malformed');
  if (action === undefined) {
    if (method !== 'GET') wrongMethod();
    return { body: false, run: () => plane.show(id, ACTOR) };
  }
  if (!ACTIONS.includes(action as Action)) throw new RequestError('No such route', 404);
  if (method !== 'POST') wrongMethod();
  switch (action as Action) {
    case 'suspend':
      return {
        body: true,
        run: (b) => {
          noParameters(b);
          return plane.suspend(id, ACTOR);
        },
      };
    case 'resume':
      return {
        body: true,
        run: (b) => {
          noParameters(b);
          return plane.resume(id, ACTOR);
        },
      };
    case 'access-code':
      return {
        body: true,
        run: async (b) => {
          noParameters(b);
          return { code: await plane.accessCode(id, ACTOR) };
        },
      };
    case 'upgrade':
      return {
        body: true,
        run: (b) => {
          noParameters(b);
          return plane.upgrade(id, ACTOR);
        },
      };
    case 'delete':
      return {
        body: true,
        run: async (body) => {
          if (!body) throw new RequestError('Deleting an account needs a JSON body');
          exact(body, 'The delete request', ['confirmation'], []);
          await plane.delete(id, text(body, 'confirmation'), ACTOR);
          return { deleted: id };
        },
      };
    case 'backup':
      return {
        body: false,
        run: () => Promise.reject(new RequestError('No such route', 404)),
        raw: async (req, res, begin) => {
          await readJson(req, false);
          begin();
          const handle = await plane.backup(id, ACTOR);
          try {
            // The length is known up front, so a client can tell a cut-off archive from a whole one.
            res.writeHead(200, {
              'content-type': TAR_TYPE,
              'content-length': handle.size,
              'cache-control': 'no-store',
              connection: 'close',
            });
            await pipeline(Readable.from(handle.stream()), res);
          } finally {
            await handle.release();
          }
        },
      };
    case 'restore':
      return {
        body: false,
        query: ['from-other-account'],
        run: () => Promise.reject(new RequestError('No such route', 404)),
        raw: async (req, res, begin) => {
          const options = restoreFlags(search);
          if (!/^application\/x-tar(?:\s*;.*)?$/iu.test(req.headers['content-type'] ?? '')) {
            throw new RequestError(`The request body must be ${TAR_TYPE}`, 415);
          }
          begin();
          let staged;
          try {
            staged = await plane.stageUpload(req);
          } catch (error) {
            // Refused before it became a command, so it is audited here.
            await audit
              .append({
                actor: ACTOR,
                command: 'restore',
                account: id,
                result: 'refused',
                reason: errorMessage(error),
              })
              .catch(() => undefined);
            throw error;
          }
          try {
            send(res, 200, { result: await plane.restore(id, staged, options, ACTOR) });
          } finally {
            await staged.remove();
          }
        },
      };
  }
}

/** Actions with no parameters accept an empty body or `{}`, nothing else. */
function noParameters(body: Json | undefined): void {
  if (body) exact(body, 'This request', [], []);
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    connection: 'close',
  });
  res.end(text);
}

export interface IAdminServerDeps {
  plane: ControlPlane;
  audit: AuditLog;
  /** Requests wait for this, so none runs before start-up recovery has finished. */
  ready?: Promise<unknown>;
}

/**
 * The admin surface: HTTP with JSON bodies, listening on a Unix socket only (the caller binds it).
 * Every request that becomes a command is audited by the control plane; one that is rejected
 * before it becomes one is audited here, without the body.
 */
export function createAdminServer({ plane, audit, ready }: IAdminServerDeps): Server {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let reached = false;
    try {
      await ready;
      const url = new URL(req.url ?? '/', 'http://admin.invalid');
      const method = req.method ?? 'GET';
      const target = route(plane, audit, method, url.pathname, url.searchParams);
      if (url.search !== '' && target.query === undefined) {
        throw new RequestError('Query strings are not accepted');
      }
      if (target.raw) {
        // The route says when the request has become a command; a refusal before that is audited here.
        await target.raw(req, res, () => {
          reached = true;
        });
        return;
      }
      const body = await readJson(req, target.body);
      reached = true;
      send(res, 200, { result: await target.run(body) });
    } catch (error) {
      if (error instanceof RequestError && !reached) {
        await audit
          .append({
            actor: ACTOR,
            command: 'request',
            account: null,
            result: 'refused',
            reason: error.message,
          })
          .catch(() => undefined);
      }
      const failure =
        error instanceof HostError ? error : new HostError('runtime-failed', 'Internal error');
      const status = error instanceof RequestError ? error.status : HTTP_STATUS[failure.code];
      const payload: IAdminErrorBody = { error: { code: failure.code, message: failure.message } };
      if (!(error instanceof HostError)) process.stderr.write(`admin: ${errorMessage(error)}\n`);
      if (!res.headersSent) send(res, status, payload);
      else res.destroy();
    }
  };
  // An archive upload can take longer than the default request timeout; only the operator's own
  // user can reach this socket, so a slow client is not a threat to guard against.
  return createServer({ requestTimeout: 0 }, (req, res) => {
    void handle(req, res);
  });
}
