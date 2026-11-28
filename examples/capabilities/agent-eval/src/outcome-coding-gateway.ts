import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';

import { redactSecret, type ICredential } from './outcome-coding-credential.js';
import { parseMicros } from './outcome-coding-pricing.js';
import type { TJson } from './outcome-coding-protocol.js';
import type { TUpstream } from './outcome-coding-relay.js';

/**
 * The host's client for the model gateway. Every function here makes exactly one HTTP request:
 * there is no retry, no redirect following and no connection reuse, so one call on this side is
 * one request on the wire, whatever the gateway answers. The credential is attached only here, only
 * over TLS (plain HTTP is accepted for a loopback address, which is how the tests run), and never
 * appears in an error message.
 */

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface IGatewayAnswer {
  readonly status: number;
  /** The parsed JSON body; `undefined` when the body was empty or not JSON. */
  readonly body: TJson | undefined;
}

export interface IGatewayRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: string;
  readonly credential?: ICredential;
  readonly signal: AbortSignal;
}

function checkTransport(url: URL): void {
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return;
  throw new Error('The gateway must be reached over TLS (plain HTTP only on a loopback address)');
}

/** One request, one attempt. Rejects on a transport failure, a timeout (abort) or an oversized body. */
export async function requestOnce(input: IGatewayRequest): Promise<IGatewayAnswer> {
  const url = new URL(input.url);
  checkTransport(url);
  const secret = input.credential?.reveal();
  const secure = url.protocol === 'https:';
  const agent = secure ? new HttpsAgent({ keepAlive: false }) : new HttpAgent({ keepAlive: false });
  return await new Promise<IGatewayAnswer>((resolve, reject) => {
    const fail = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      reject(new Error(secret === undefined ? message : redactSecret(secret, message)));
    };
    const send = secure ? httpsRequest : httpRequest;
    const outgoing = send(
      url,
      {
        method: input.method,
        agent,
        signal: input.signal,
        headers: {
          accept: 'application/json',
          connection: 'close',
          ...(input.body === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(input.body)),
              }),
          ...(secret === undefined ? {} : { authorization: `Bearer ${secret}` }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new Error('The gateway response exceeds the size bound'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', fail);
        response.on('aborted', () => fail(new Error('The gateway response was cut off')));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: TJson | undefined;
          try {
            body = text.length === 0 ? undefined : (JSON.parse(text) as TJson);
          } catch {
            body = undefined;
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    outgoing.on('error', fail);
    outgoing.on('close', () => agent.destroy());
    outgoing.end(input.body);
  });
}

/**
 * The live reply source for the relay: sends the already validated, already admitted request body
 * once and returns what the gateway answered. A non-JSON answer is reported as a failure; the relay
 * never calls this twice for one admission.
 */
export function createGatewayUpstream(options: {
  readonly endpoint: string;
  readonly credential: ICredential;
}): TUpstream {
  return async ({ url, body, signal }) => {
    if (url !== options.endpoint)
      throw new Error('The request names an endpoint the upstream was not built for');
    const answer = await requestOnce({
      url,
      method: 'POST',
      body,
      credential: options.credential,
      signal,
    });
    if (answer.body === undefined)
      throw new Error(`The gateway answered ${answer.status} without a JSON body`);
    return { status: answer.status, body: answer.body };
  };
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface IGatewayLocation {
  /** Base URL of the gateway's API, without a trailing slash (the chat endpoint is `<base>/chat/completions`). */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}

async function getJson(
  location: IGatewayLocation,
  path: string,
  credential?: ICredential,
): Promise<IGatewayAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), location.timeoutMs ?? 15_000);
  try {
    return await requestOnce({
      url: `${location.baseUrl}${path}`,
      method: 'GET',
      ...(credential === undefined ? {} : { credential }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches the pinned model's endpoint listing (public, no credential), for the basis check. */
export async function fetchEndpointListing(
  location: IGatewayLocation,
  model: string,
): Promise<TJson> {
  const answer = await getJson(
    location,
    `/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`,
  );
  if (answer.status !== 200 || answer.body === undefined) {
    throw new Error(`The endpoint listing answered ${answer.status}`);
  }
  return answer.body;
}

/** True when the gateway's catalog (public, no credential) still lists the pinned model. */
export async function catalogListsModel(
  location: IGatewayLocation,
  model: string,
): Promise<boolean> {
  const answer = await getJson(location, '/models');
  const data = isObject(answer.body) ? answer.body.data : undefined;
  if (answer.status !== 200 || !Array.isArray(data)) {
    throw new Error(`The catalog answered ${answer.status}`);
  }
  return data.some((entry) => isObject(entry) && entry.id === model);
}

export interface ICreditsCheck {
  readonly remainingMicros: number;
  readonly sufficient: boolean;
}

/**
 * Reads the remaining credit (`data.total_credits` minus `data.total_usage`, in dollars) with the
 * credential and compares it with what the next reservation needs. Only the sufficiency and the
 * remaining amount leave this function.
 */
export async function checkCredits(
  location: IGatewayLocation,
  credential: ICredential,
  requiredMicros: number,
): Promise<ICreditsCheck> {
  const answer = await getJson(location, '/credits', credential);
  const data = isObject(answer.body) ? answer.body.data : undefined;
  if (answer.status !== 200 || !isObject(data))
    throw new Error(`The credits check answered ${answer.status}`);
  // Credit is rounded down and usage up, so the remaining amount is never overstated.
  const total = parseMicros(data.total_credits, 'down');
  const used = parseMicros(data.total_usage, 'up');
  if (total === undefined || used === undefined) throw new Error('The credits answer is malformed');
  const remainingMicros = total - used;
  return { remainingMicros, sufficient: remainingMicros >= requiredMicros };
}
