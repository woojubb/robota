import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  bearerCredential,
  createBearerResourceServer,
  describeProtectedResource,
  refuseBearerToken,
  serveProtectedResourceMetadata,
  type IBearerFailure,
  type IProtectedResource,
} from '@robota-sdk/agent-transport/node';

import type {
  IExternalEventDelivery,
  IExternalEventGrant,
  TExternalEventAdmission,
  TExternalEventAuditRecord,
  TExternalEventRefusal,
} from '@robota-sdk/agent-interface-transport';

/**
 * The first external-event carrier: `POST <publicUrl>/events/<grantId>` over HTTP on loopback, behind
 * the owner's own reverse proxy or tunnel, which terminates TLS at the public URL.
 *
 * It only moves the bearer token and the event to the session's grants; who sent it is decided there,
 * by the grant's verifier. It answers with an admission receipt or an empty refusal and never with
 * anything the turn produced. The admission rules it shares with every token-admitted HTTP carrier
 * (names, challenges, metadata, failure throttle) come from the shared resource-server gate.
 */

const LABEL = 'External event endpoint';
/** The whole request body; the event content bound sits inside it. */
const MAX_BODY_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const LOOPBACK_BINDS = new Set(['127.0.0.1', '::1']);
const EVENTS_SEGMENT = '/events/';

export interface IExternalEventHttpHostOptions {
  /** Every grant the session holds; each grant's resource must be `<publicUrl>/events/<grantId>`. */
  readonly grants: readonly IExternalEventGrant[];
  /** The session's grants: verification, admission and settlement happen there. */
  readonly receive: (
    grantId: string,
    delivery: IExternalEventDelivery,
  ) => Promise<TExternalEventAdmission>;
  /** Count a refusal this endpoint decides itself against the grant it addressed. */
  readonly countRefusal?: (grantId: string, refusal: TExternalEventRefusal) => void;
  /** Loopback port; 0 picks one. */
  readonly port: number;
  readonly bindAddress?: '127.0.0.1' | '::1';
  /** Proxy addresses whose `X-Forwarded-For` is believed. */
  readonly trustedProxies?: readonly string[];
  /** One content-free record per refusal this endpoint answers. */
  readonly audit?: (record: TExternalEventAuditRecord) => void;
  readonly now?: () => number;
}

export interface IExternalEventHttpHost {
  /** The public URL every grant's endpoint hangs from. */
  readonly publicUrl: string;
  start(): Promise<{ readonly port: number }>;
  stop(): Promise<void>;
}

interface IRoute {
  readonly grantId: string;
  readonly resource: IProtectedResource;
}

/** How a refusal is answered, and whether it counts against the peer's failure budget. */
function answerFor(refusal: TExternalEventRefusal): {
  readonly counted: boolean;
  readonly answer:
    | {
        readonly kind: 'token';
        readonly refusal: 'missing-token' | 'missing-scope' | 'invalid-token';
      }
    | { readonly kind: 'status'; readonly status: number };
} {
  switch (refusal) {
    case 'missing-token':
    case 'missing-scope':
      return { counted: true, answer: { kind: 'token', refusal } };
    case 'unknown-grant':
      return { counted: true, answer: { kind: 'status', status: 404 } };
    case 'grant-revoked':
      return { counted: true, answer: { kind: 'status', status: 403 } };
    case 'malformed-event':
      return { counted: true, answer: { kind: 'status', status: 400 } };
    case 'rate-limited':
      return { counted: false, answer: { kind: 'status', status: 429 } };
    case 'keys-unavailable':
    case 'source-closed':
    case 'queue-full':
    case 'shutting-down':
    case 'session-unavailable':
      // The issuer or the session failed, not the peer: nothing is counted against it.
      return { counted: false, answer: { kind: 'status', status: 503 } };
    default:
      // Every other word is the verifier's verdict on the token itself, or its size.
      return { counted: true, answer: { kind: 'token', refusal: 'invalid-token' } };
  }
}

/** The one public URL every grant hangs from: each resource minus its `/events/<grantId>`. */
function publicUrlOf(grants: readonly IExternalEventGrant[]): string {
  if (grants.length === 0) throw new Error(`${LABEL} needs at least one grant`);
  const bases = new Set(
    grants.map((grant) => {
      const suffix = `${EVENTS_SEGMENT}${grant.grantId}`;
      const resource = grant.verifier.resource;
      if (!resource.endsWith(suffix)) {
        throw new Error(`${LABEL}: grant ${grant.grantId} resource must end in ${suffix}`);
      }
      const base = resource.slice(0, -suffix.length);
      // Compare the URLs, not their spelling: `https://Host/x` and `https://host/x` are one URL.
      return URL.canParse(base) ? new URL(base).href : base;
    }),
  );
  if (bases.size !== 1) throw new Error(`${LABEL}: all grants must share one public URL`);
  return [...bases][0]!;
}

interface IEndpointConfiguration {
  readonly publicUrl: string;
  readonly server: ReturnType<typeof createBearerResourceServer>;
  readonly routes: ReadonlyMap<string, IRoute>;
  readonly metadata: ReadonlyMap<string, IProtectedResource>;
  readonly eventsPrefix: string;
}

function configure(
  options: Pick<IExternalEventHttpHostOptions, 'grants' | 'trustedProxies' | 'now'>,
): IEndpointConfiguration {
  const publicUrl = publicUrlOf(options.grants);
  const server = createBearerResourceServer({
    publicUrl,
    ...(options.trustedProxies !== undefined ? { trustedProxies: options.trustedProxies } : {}),
    label: LABEL,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const basePath = server.url.pathname.replace(/\/$/u, '');
  const routes = new Map<string, IRoute>();
  const metadata = new Map<string, IProtectedResource>();
  for (const grant of options.grants) {
    let resource: IProtectedResource;
    try {
      resource = describeProtectedResource({
        resource: grant.verifier.resource,
        issuer: grant.verifier.issuer,
        scopes: grant.verifier.requiredScopes,
        label: LABEL,
      });
    } catch (error) {
      // The messages name what is wrong, never a configured value.
      throw new Error(
        `grant ${grant.grantId}: ${error instanceof Error ? error.message : 'cannot be served'}`,
      );
    }
    routes.set(`${basePath}${EVENTS_SEGMENT}${grant.grantId}`, {
      grantId: grant.grantId,
      resource,
    });
    metadata.set(resource.wellKnownPath, resource);
  }
  return { publicUrl, server, routes, metadata, eventsPrefix: `${basePath}${EVENTS_SEGMENT}` };
}

/**
 * Check, without listening, that these grants and proxies can be served, so a launcher can refuse a
 * start before it spawns anything. Throws with a reason that names a grant, never a configured value.
 */
export function validateExternalEventEndpoint(
  options: Pick<IExternalEventHttpHostOptions, 'grants' | 'trustedProxies'>,
): void {
  configure(options);
}

/** Bytes of an oversize body read and discarded before the 413, so the client can finish its write. */
const MAX_DRAIN_BYTES = 1024 * 1024;

/**
 * Read and discard what the client is still sending. Resolves true once the body has ended, so an
 * answer written then reaches a client that is no longer writing; false when the client sent more
 * than the bound and the connection was cut, which RFC 9110 permits for an oversize request.
 */
function discardRest(req: IncomingMessage): Promise<boolean> {
  if (req.readableEnded) return Promise.resolve(true);
  if (req.destroyed) return Promise.resolve(false);
  return new Promise((resolve) => {
    let drained = 0;
    req.on('data', (chunk: Buffer) => {
      drained += chunk.length;
      if (drained > MAX_DRAIN_BYTES) {
        req.destroy();
        resolve(false);
      }
    });
    req.once('end', () => resolve(true));
    req.once('close', () => resolve(req.readableEnded));
    req.on('error', () => resolve(false));
    req.resume();
  });
}

/** Read the body up to the bound; `undefined` when it is larger. Never buffers past the bound. */
function readBody(req: IncomingMessage): Promise<string | undefined> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        done = true;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (done) return;
      done = true;
      reject(error);
    });
  });
}

function parseEvent(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    // The session judges the event only after the token; a body that is not JSON is no event.
    return undefined;
  }
}

/**
 * Build the endpoint. Throws when it cannot be served safely: no grant, grants on different public
 * URLs, a public URL or issuer that is not `https`, a bad scope, a non-loopback bind, or a trusted
 * proxy that is not a literal address.
 */
export function createExternalEventHttpHost(
  options: IExternalEventHttpHostOptions,
): IExternalEventHttpHost {
  const bindAddress = options.bindAddress ?? '127.0.0.1';
  if (!LOOPBACK_BINDS.has(bindAddress)) throw new Error(`${LABEL} binds only a loopback address`);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error(`${LABEL} port must be an integer in 0..65535`);
  }
  const { publicUrl, server, routes, metadata, eventsPrefix } = configure(options);

  const audit = (record: TExternalEventAuditRecord): void => {
    try {
      options.audit?.(record);
    } catch {
      // A reporting sink cannot change an answer.
    }
  };

  /** Charge and audit a refusal; every refusal is recorded, whether or not an answer can be sent. */
  function judge(
    req: IncomingMessage,
    refusal: TExternalEventRefusal,
    route: IRoute | undefined,
    counted: boolean,
  ): IBearerFailure {
    const failure: IBearerFailure = counted
      ? server.fail(req)
      : { remote: server.remote(req), throttled: false, retryAfterSeconds: 0 };
    audit({
      at: new Date().toISOString(),
      ...(route !== undefined ? { grantId: route.grantId } : {}),
      refusal,
      remote: failure.remote,
      throttled: failure.throttled,
    });
    return failure;
  }

  function refuse(
    req: IncomingMessage,
    res: ServerResponse,
    refusal: TExternalEventRefusal,
    route: IRoute | undefined,
  ): void {
    const { counted, answer } = answerFor(refusal);
    answerRefusal(res, route, answer, judge(req, refusal, route, counted));
  }

  function answerRefusal(
    res: ServerResponse,
    route: IRoute | undefined,
    answer: ReturnType<typeof answerFor>['answer'],
    failure: IBearerFailure,
  ): void {
    if (failure.throttled) {
      res.writeHead(429, { 'Retry-After': String(failure.retryAfterSeconds) }).end();
    } else if (answer.kind === 'token' && route !== undefined) {
      refuseBearerToken(res, route.resource, answer.refusal, failure);
    } else if (answer.kind === 'token') {
      res.writeHead(401).end();
    } else {
      res.writeHead(answer.status).end();
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!server.checkNames(req, res)) return;
    const path = req.url ?? '';
    const described = metadata.get(path);
    if (described !== undefined) {
      serveProtectedResourceMetadata(req, res, described);
      return;
    }
    const route = routes.get(path);
    if (route === undefined) {
      const segment = path.startsWith(eventsPrefix) ? path.slice(eventsPrefix.length) : undefined;
      // Which labels exist is public: each grant's RFC 9728 metadata names it, and a token client needs
      // that to find its issuer. What stays private is a grant's state, decided only after the token.
      if (segment !== undefined && /^[a-zA-Z0-9_-]{1,64}$/u.test(segment)) {
        refuse(req, res, 'unknown-grant', undefined);
      } else {
        res.writeHead(404).end();
      }
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    const count = (refusal: TExternalEventRefusal): void => {
      try {
        options.countRefusal?.(route.grantId, refusal);
      } catch {
        // Counting cannot change an answer.
      }
    };
    // Neither answer below depends on the grant's state, so they may come before the session's check.
    const token = bearerCredential(req.headers.authorization);
    if (token === undefined) {
      count('missing-token');
      refuse(req, res, 'missing-token', route);
      return;
    }
    const body = await readBody(req);
    if (body === undefined) {
      // The body, not the token, is too large: 413, counted, before anything is verified. The rest is
      // discarded, not kept; the answer goes out once the client stopped writing, and the connection
      // closes after it (RFC 9110 §15.5.14).
      count('oversize');
      const failure = judge(req, 'oversize', route, true);
      // A body declared past the drain bound is not read at all: the connection is cut after the
      // answer, which the client may see as a reset, as RFC 9110 allows for an oversize request.
      const declared = Number(req.headers['content-length']);
      const drained =
        Number.isFinite(declared) && declared > MAX_DRAIN_BYTES ? true : await discardRest(req);
      if (!drained) return;
      res.setHeader('Connection', 'close');
      answerRefusal(res, route, { kind: 'status', status: 413 }, failure);
      return;
    }
    const admission = await options.receive(route.grantId, { token, event: parseEvent(body) });
    if (admission.admitted) {
      res
        .writeHead(202, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ turnId: admission.turnId }));
      return;
    }
    refuse(req, res, admission.refusal, route);
  }

  const http = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });
  http.requestTimeout = REQUEST_TIMEOUT_MS;
  http.headersTimeout = REQUEST_TIMEOUT_MS;
  let started = false;

  return {
    publicUrl,
    start: () =>
      new Promise((resolve, reject) => {
        if (started) {
          reject(new Error(`${LABEL} is already started`));
          return;
        }
        started = true;
        http.once('error', reject);
        http.listen(options.port, bindAddress, () => {
          http.off('error', reject);
          const address = http.address();
          resolve({
            port: typeof address === 'object' && address !== null ? address.port : options.port,
          });
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        if (!started) {
          resolve();
          return;
        }
        started = false;
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
