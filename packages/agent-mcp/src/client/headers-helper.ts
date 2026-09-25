/**
 * The dynamic header helper: a host-run program whose output becomes a remote server's request
 * headers, through the client authentication port.
 *
 * The host owns running it — this package never spawns the helper. What is decided here is whether
 * a declared helper may run at all (the host's allowlist and workspace trust), what its output may
 * contain, and when it runs: once per connection, one run at a time, and once more after the server
 * refuses the headers it produced.
 *
 * The helper's output is a credential. No part of it, and nothing the helper printed elsewhere,
 * enters an error, a diagnostic or a log; a failure is named by a fixed reason only.
 */

import { MCPSingleFlightCache } from './single-flight.js';

import type { IMCPActivationWorkspace, TMCPActivationSource } from '../mcp-activation.js';
import type { IMCPHeadersHelper } from '../definition/types.js';
import type {
  IMCPAuthorizationRejection,
  IMCPAuthorizationRequest,
  IMCPClientAuthenticator,
} from './authentication.js';

/**
 * Why a declared helper may not run, so the server is not connected:
 * - `headers-helper-not-allowed` — its exact command and arguments are not on the host allowlist;
 * - `headers-helper-untrusted` — a project or local definition declared it in an untrusted workspace.
 */
export type TMCPHeadersHelperRefusal = 'headers-helper-not-allowed' | 'headers-helper-untrusted';

/** Why a helper run produced no headers. */
export type TMCPHeadersHelperFailure =
  | 'spawn-failed'
  | 'exit-status'
  | 'timeout'
  | 'cancelled'
  | 'output-too-large'
  | 'output-malformed'
  | 'header-name-invalid'
  | 'header-value-invalid'
  | 'header-duplicate'
  | 'header-forbidden'
  | 'too-many-headers';

/** A helper run that produced no headers, named without anything the helper printed. */
export class MCPHeadersHelperError extends Error {
  constructor(readonly reason: TMCPHeadersHelperFailure) {
    super(`MCP headers helper failed (${reason})`);
    this.name = 'MCPHeadersHelperError';
  }
}

/** Sources whose helper runs only in a trusted workspace: the ones a repository can supply. */
const WORKSPACE_SOURCES: ReadonlySet<TMCPActivationSource> = new Set(['project', 'local']);

/** Whether this source's helper must be treated as repository-supplied. */
export function isWorkspaceHelperSource(source: TMCPActivationSource): boolean {
  return WORKSPACE_SOURCES.has(source);
}

/**
 * Whether a declared helper may run. `allowed` is the host's allowlist, which no definition can
 * extend; a helper matches only by its exact command and exact argument list.
 */
export function refuseHeadersHelper(
  helper: IMCPHeadersHelper,
  source: TMCPActivationSource,
  workspace: IMCPActivationWorkspace | undefined,
  allowed: readonly IMCPHeadersHelper[],
): TMCPHeadersHelperRefusal | undefined {
  const listed = allowed.some(
    (candidate) =>
      candidate.command === helper.command &&
      candidate.args.length === helper.args.length &&
      candidate.args.every((arg, index) => arg === helper.args[index]),
  );
  if (!listed) return 'headers-helper-not-allowed';
  if (isWorkspaceHelperSource(source) && workspace?.trustState !== 'trusted') {
    return 'headers-helper-untrusted';
  }
  return undefined;
}

const MAX_HEADERS = 32;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Visible Latin-1 and inner spaces or tabs; no control character, so no header can be split. */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
/** Headers the transport and protocol own; a helper supplying one would redefine the request. */
const FORBIDDEN_HEADERS: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'content-type',
  'accept',
  'mcp-session-id',
  'mcp-protocol-version',
  'traceparent',
]);

const WHITESPACE = /[ \t\n\r]*/y;
// A JSON string literal: its grammar forbids raw control characters, so the class must name them.
// eslint-disable-next-line no-control-regex
const JSON_STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;

/**
 * Read `{ "name": "value", … }` exactly: one object of string values, nothing after it. Hand-read
 * rather than `JSON.parse`d because the platform parser silently keeps the last of two identical
 * keys, and a duplicate must be refused, not resolved.
 */
function readFlatObject(text: string): [string, string][] | undefined {
  let at = 0;
  const skip = (): void => {
    WHITESPACE.lastIndex = at;
    WHITESPACE.exec(text);
    at = WHITESPACE.lastIndex;
  };
  const literal = (): string | undefined => {
    JSON_STRING.lastIndex = at;
    const match = JSON_STRING.exec(text);
    if (match === null) return undefined;
    at = JSON_STRING.lastIndex;
    return JSON.parse(match[0]) as string;
  };
  const entries: [string, string][] = [];
  skip();
  if (text[at] !== '{') return undefined;
  at += 1;
  skip();
  if (text[at] === '}') {
    at += 1;
  } else {
    for (;;) {
      const name = literal();
      if (name === undefined) return undefined;
      skip();
      if (text[at] !== ':') return undefined;
      at += 1;
      skip();
      const value = literal();
      if (value === undefined) return undefined;
      entries.push([name, value]);
      skip();
      if (text[at] === ',') {
        at += 1;
        skip();
        continue;
      }
      if (text[at] !== '}') return undefined;
      at += 1;
      break;
    }
  }
  skip();
  return at === text.length ? entries : undefined;
}

/** The headers a helper printed, or a refusal naming only which rule its output broke. */
export function parseHeadersHelperOutput(text: string): Readonly<Record<string, string>> {
  const entries = readFlatObject(text);
  if (entries === undefined) throw new MCPHeadersHelperError('output-malformed');
  if (entries.length > MAX_HEADERS) throw new MCPHeadersHelperError('too-many-headers');
  const seen = new Set<string>();
  const headers: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw new MCPHeadersHelperError('header-name-invalid');
    const lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower)) throw new MCPHeadersHelperError('header-forbidden');
    if (seen.has(lower)) throw new MCPHeadersHelperError('header-duplicate');
    seen.add(lower);
    if (!HEADER_VALUE.test(value)) throw new MCPHeadersHelperError('header-value-invalid');
    headers[name] = value;
  }
  return Object.freeze(headers);
}

/** Runs the helper once and resolves with everything it wrote to stdout. The host owns this. */
export type TMCPHeadersHelperRun = (signal: AbortSignal) => Promise<string>;

export interface IMCPHeadersHelperAuthenticator extends IMCPClientAuthenticator {
  /** Cancel a running helper and refuse later requests; called when the connection ends. */
  close(): void;
}

/**
 * An authenticator whose headers come from a helper. The headers are reused for every request of
 * the connection; a refusal from the server discards them and asks for one fresh run.
 */
export function createHeadersHelperAuthenticator(
  run: TMCPHeadersHelperRun,
): IMCPHeadersHelperAuthenticator {
  const cache = new MCPSingleFlightCache(async (signal) =>
    parseHeadersHelperOutput(await run(signal)),
  );
  // Each request gets its own copy, so a refusal names exactly the generation that request sent.
  const issued = new WeakMap<object, number>();
  return {
    authorize: async (request: IMCPAuthorizationRequest) => {
      const { value, generation } = await cache.getEntry(request.signal);
      const copy = Object.freeze({ ...value });
      issued.set(copy, generation);
      return copy;
    },
    onRejected: async (rejection: IMCPAuthorizationRejection) => {
      const generation = issued.get(rejection.authorization);
      // Headers this authenticator did not issue: there is nothing of its own to refresh.
      if (generation === undefined) return 'fail';
      cache.invalidate(generation);
      return 'retry';
    },
    close: () => cache.close(),
  };
}
