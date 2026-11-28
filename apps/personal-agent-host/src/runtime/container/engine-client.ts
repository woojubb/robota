import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** The oldest Engine API version the backend relies on. */
export const API_FLOOR = '1.41';
/** The newest version it asks for; a newer engine is spoken to at this version. */
export const API_CEILING = '1.45';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** A refusal or failure from the engine. The message never carries a request body. */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export function isNotFound(error: unknown): boolean {
  return error instanceof EngineError && error.status === 404;
}

function parseVersion(text: string): [number, number] | undefined {
  const match = /^(\d+)\.(\d+)$/u.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a) ?? [0, 0];
  const right = parseVersion(b) ?? [0, 0];
  return left[0] - right[0] || left[1] - right[1];
}

/** The version to speak: the newest both sides know, refused when it falls below the floor. */
export function negotiateVersion(serverVersion: string, serverMinimum: string): string {
  if (parseVersion(serverVersion) === undefined) {
    throw new EngineError(
      `The engine reported an unreadable API version "${serverVersion}"`,
      undefined,
    );
  }
  const chosen = compareVersions(serverVersion, API_CEILING) > 0 ? API_CEILING : serverVersion;
  if (compareVersions(chosen, API_FLOOR) < 0) {
    throw new EngineError(
      `The engine speaks API ${serverVersion}; at least ${API_FLOOR} is required`,
      undefined,
    );
  }
  if (parseVersion(serverMinimum) !== undefined && compareVersions(chosen, serverMinimum) < 0) {
    throw new EngineError(
      `The engine needs API ${serverMinimum} or newer, above the ${chosen} this host speaks`,
      undefined,
    );
  }
  return chosen;
}

interface ITarget {
  options: RequestOptions;
  secure: boolean;
}

function targetOf(endpoint: string): ITarget {
  const url = new URL(endpoint);
  if (url.protocol === 'unix:') {
    return { options: { socketPath: url.pathname }, secure: false };
  }
  return {
    options: {
      host: url.hostname.replace(/^\[|\]$/gu, ''),
      port: url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port),
    },
    secure: url.protocol === 'https:',
  };
}

export interface IEngineCall {
  query?: Record<string, string>;
  body?: unknown;
  /** Replaces the default timeout; long waits set their own. */
  timeoutMs?: number;
}

export interface IEngineClientOptions {
  /** `unix:///path/to.sock`, `https://host:port`, or `http://` on loopback. */
  endpoint: string;
  timeoutMs?: number;
}

/**
 * A small client of the Engine API: structured JSON over the engine's socket, with the API
 * version negotiated once. It has no knowledge of what the calls mean.
 */
export class EngineClient {
  private readonly target: ITarget;
  private version: Promise<string> | undefined;

  constructor(private readonly options: IEngineClientOptions) {
    this.target = targetOf(options.endpoint);
  }

  private send(
    method: string,
    path: string,
    call: IEngineCall,
  ): Promise<{ status: number; text: string }> {
    const query = new URLSearchParams(call.query ?? {}).toString();
    const body = call.body === undefined ? undefined : JSON.stringify(call.body);
    const timeout = call.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestFn = this.target.secure ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          ...this.target.options,
          method,
          path: query === '' ? path : `${path}?${query}`,
          agent: false,
          headers: {
            accept: 'application/json, text/plain',
            ...(body !== undefined
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
              : {}),
          },
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy(new EngineError('The engine answered with too much data', undefined));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
          );
          res.on('error', reject);
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(
          new EngineError(`The engine did not answer ${method} ${path} in time`, undefined),
        ),
      );
      req.on('error', (error) =>
        reject(
          error instanceof EngineError
            ? error
            : new EngineError(
                `Cannot reach the engine at ${this.options.endpoint}: ${error.message}`,
                undefined,
              ),
        ),
      );
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  /** The API version in use, negotiated on first use. */
  apiVersion(): Promise<string> {
    this.version ??= (async () => {
      const { status, text } = await this.send('GET', '/version', {});
      if (status !== 200) throw new EngineError(`The engine refused /version (${status})`, status);
      const info = JSON.parse(text) as { ApiVersion?: string; MinAPIVersion?: string };
      return negotiateVersion(info.ApiVersion ?? '', info.MinAPIVersion ?? '');
    })().catch((error: unknown) => {
      this.version = undefined;
      throw error;
    });
    return this.version;
  }

  /** Sends a call and returns the raw text of a success; any other status is an EngineError. */
  async text(method: string, path: string, call: IEngineCall = {}): Promise<string> {
    const version = await this.apiVersion();
    const { status, text } = await this.send(method, `/v${version}${path}`, call);
    if (status >= 200 && status < 300) return text;
    let reason = text.trim();
    try {
      const parsed = JSON.parse(text) as { message?: unknown };
      if (typeof parsed.message === 'string') reason = parsed.message;
    } catch {
      // Not JSON: the raw text stands in.
    }
    throw new EngineError(
      `Engine ${method} ${path} failed (${status}): ${reason.slice(0, 400)}`,
      status,
    );
  }

  async json<T>(method: string, path: string, call: IEngineCall = {}): Promise<T> {
    const text = await this.text(method, path, call);
    return (text.trim() === '' ? {} : JSON.parse(text)) as T;
  }
}
