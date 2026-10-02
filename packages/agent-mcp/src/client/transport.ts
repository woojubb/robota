/**
 * Transport seam: ADMIT, then CONSTRUCT (spec § Decision, MCP-002).
 *
 * Every transport contributes a typed admission step whose result is the only thing the
 * constructor accepts. HTTP admits a URL through the shared egress policy (SSRF boundary owned by
 * `@robota-sdk/agent-core/node`); the stdio adapter admits an executable, exact argv, environment
 * values and a cwd authority in the same slot. Nothing here opens a connection: constructing an
 * SDK transport is inert until a `Client` connects it.
 *
 * The supported set is Streamable HTTP and stdio. Deprecated HTTP+SSE and custom socket bindings
 * are refusals surfaced in the catalog, not adapters.
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rejectDestination } from '@robota-sdk/agent-core/node';

import { MCPAuthenticationError, type IMCPBoundAuthenticator } from './authentication.js';
import { createMcpPinnedFetch } from './pinned-http-fetch.js';
import {
  DEFAULT_MCP_RECEIVE_BYTES,
  SKILL_RESOURCE_RECEIVE_BYTES,
  skillReceiveBudgetEnabled,
} from './receive-budget.js';
import {
  MCPCallTraceRegistry,
  bindCallTraceRegistry,
  callTraceHeaders,
  callRequestSignal,
  cancelledRequestId,
  currentCallTraceScope,
  runInCallTraceScope,
  toolsCallRequestId,
} from './trace-propagation.js';

import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { IEgressPolicy, TEgressLookup } from '@robota-sdk/agent-core/node';

export type TMCPTransportKind = 'streamable-http' | 'stdio';

/** A refusal names the policy's reason; it never guesses. */
export type TMCPTransportAdmission<TAdmitted> =
  | { readonly ok: true; readonly admitted: TAdmitted }
  | { readonly ok: false; readonly reason: string; readonly message: string };

export interface IMCPTransportAdapter<TInput, TAdmitted> {
  readonly kind: TMCPTransportKind;
  /** Runs BEFORE any environment access, transport construction, network action or process spawn. */
  admit(input: TInput): Promise<TMCPTransportAdmission<TAdmitted>>;
  /** Accepts only what `admit` produced. Inert until connected. */
  construct(admitted: TAdmitted): Transport;
}

export interface IMCPHttpEndpoint {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** The authenticator the host registered for this server, if any. */
  readonly authentication?: IMCPBoundAuthenticator;
  /** Authentication the definition declares that this version cannot perform. */
  readonly unsupportedAuthentication?: readonly string[];
  /** The definition obtains its credential dynamically, so admission without an authenticator is refused. */
  readonly authenticationRequired?: boolean;
}

export interface IMCPAdmittedHttpEndpoint {
  readonly kind: 'streamable-http';
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly authentication?: IMCPBoundAuthenticator;
  /** Owner policy/resolver captured at admission, also used at every actual request/reconnect. */
  readonly egress?: { readonly policy: IEgressPolicy; readonly lookup?: TEgressLookup };
}

export interface IMCPHttpTransportDeps {
  /** Egress policy; default refuses private, loopback and metadata destinations. */
  readonly policy?: IEgressPolicy;
  /** Hostname resolver injected so tests never touch DNS. */
  readonly lookup?: TEgressLookup;
  /** Trusted owner/test carrier; it owns its connection policy instead of the default's pinning guarantee. */
  readonly fetch?: typeof globalThis.fetch;
}

const POLICY_REFUSAL = 'egress-policy';

/** Inclusive HTTP redirect status range (300–399). */
const HTTP_REDIRECT_STATUS_MIN = 300;
const HTTP_REDIRECT_STATUS_MAX_EXCLUSIVE = 400;
/** Includes JSON framing and metadata around the 500,000-character admitted result ceiling. */

export class MCPTransportResponseLimitError extends Error {
  constructor() {
    super('MCP response exceeded the receive byte limit');
    this.name = 'MCPTransportResponseLimitError';
  }
}

/** Count bytes before the SDK parses JSON or SSE; cancellation propagates to the fetch body. */
function boundResponseBody(response: Response, maxBytes: number): Response {
  if (!response.body) return response;
  let received = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes) {
          throw new MCPTransportResponseLimitError();
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * The admitted URL is the only URL spoken to — a redirect is REFUSED, never followed. Thrown by the
 * fetch wrapper `constructStreamableHttpTransport` installs when the admitted origin responds with
 * any 3xx: following it would hand the request's headers (set by the caller as trusted for the
 * admitted origin) to a second, un-admitted destination, defeating the whole point of admission.
 */
function originOf(url: string, base?: string): string {
  try {
    return new URL(url, base).origin;
  } catch {
    // allow-fallback: an unparseable location is named without its text
    return 'an unparseable location';
  }
}

export class MCPTransportRedirectRefusedError extends Error {
  constructor(
    readonly status: number,
    readonly location: string | undefined,
    admittedUrl: string,
  ) {
    // Origins only: a path or query can carry a credential a template expanded, and an error
    // message is printed and logged.
    super(
      `Streamable HTTP transport refused a redirect (${status}) from ${originOf(admittedUrl)} to ` +
        `${location === undefined ? 'an undisclosed location' : originOf(location, admittedUrl)}: ` +
        'the admitted URL is the only URL spoken to',
    );
    this.name = 'MCPTransportRedirectRefusedError';
  }
}

/**
 * Admit a Streamable HTTP endpoint. `http:` outside loopback, private ranges and cloud metadata
 * addresses are refused by the shared policy with its own reason; nothing is connected to decide.
 */
export async function admitHttpEndpoint(
  endpoint: IMCPHttpEndpoint,
  deps: IMCPHttpTransportDeps = {},
): Promise<TMCPTransportAdmission<IMCPAdmittedHttpEndpoint>> {
  // A server that needs authentication this version cannot perform would only be refused by the
  // server; refusing here says why, and never connects without the credential it asked for.
  if (
    endpoint.unsupportedAuthentication !== undefined &&
    endpoint.unsupportedAuthentication.length > 0
  ) {
    return {
      ok: false,
      reason: 'unsupported-authentication',
      message:
        `The definition declares ${endpoint.unsupportedAuthentication.join(', ')} authentication, ` +
        'which this version does not support; the server was not connected.',
    };
  }
  // Static headers alone are not the server's credential; connecting with them would be an
  // unauthenticated attempt with whatever the definition happened to carry.
  if (endpoint.authenticationRequired === true && endpoint.authentication === undefined) {
    return {
      ok: false,
      reason: 'authentication-unavailable',
      message:
        'The definition obtains its headers dynamically and no authenticator was registered; ' +
        'the server was not connected.',
    };
  }
  if (!URL.canParse(endpoint.url)) {
    // The text is not printed: a template may have expanded a credential into it.
    return { ok: false, reason: 'invalid-url', message: 'The configured URL is not a valid URL' };
  }
  const url = new URL(endpoint.url);
  const policy = Object.freeze({
    ...deps.policy,
    ...(deps.policy?.allowedHosts
      ? { allowedHosts: Object.freeze([...deps.policy.allowedHosts]) }
      : {}),
  });
  const lookup = deps.lookup;
  const rejection = lookup
    ? await rejectDestination(url, policy, lookup)
    : await rejectDestination(url, policy);
  if (rejection) {
    return {
      ok: false,
      reason: `${POLICY_REFUSAL}:${rejection.reason}`,
      message: rejection.message,
    };
  }
  return {
    ok: true,
    admitted: {
      kind: 'streamable-http',
      url,
      headers: { ...(endpoint.headers ?? {}) },
      ...(endpoint.authentication === undefined ? {} : { authentication: endpoint.authentication }),
      egress: {
        policy,
        ...(lookup ? { lookup } : {}),
      },
    },
  };
}

/**
 * Records each traced `tools/call` against its JSON-RPC id when the SDK hands it over, and sends a
 * cancellation inside the context of the call it cancels. Both happen synchronously in `send`: the
 * SDK issues a cancellation from wherever the abort or timeout fired and settles the call right
 * after, so a lookup deferred to the fetch could miss a call already released.
 */
class TracingStreamableHTTPClientTransport extends StreamableHTTPClientTransport {
  constructor(
    url: URL,
    options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1],
    private readonly callTraces: MCPCallTraceRegistry,
    private readonly closeCarrier: () => Promise<void>,
  ) {
    super(url, options);
  }

  override async close(): Promise<void> {
    await Promise.all([this.closeCarrier(), super.close()]);
  }

  override send(
    message: JSONRPCMessage | JSONRPCMessage[],
    options?: TransportSendOptions,
  ): Promise<void> {
    const running = currentCallTraceScope();
    const callId = toolsCallRequestId(message);
    if (running !== undefined && callId !== undefined) {
      this.callTraces.record(callId, running);
    }
    const cancelledId = cancelledRequestId(message);
    const cancelled = cancelledId === undefined ? undefined : this.callTraces.lookup(cancelledId);
    if (cancelled !== undefined) {
      cancelled.requestAbortController?.abort();
      return runInCallTraceScope(cancelled, () => super.send(message, options));
    }
    return super.send(message, options);
  }
}

/** The request init with `traceparent` added to a copy of its headers; the original is never touched. */
function withTraceHeaders(
  init: RequestInit | undefined,
  traceHeaders: Readonly<Record<string, string>>,
): RequestInit | undefined {
  const entries = Object.entries(traceHeaders);
  if (entries.length === 0) return init;
  const headers = new Headers(init?.headers);
  for (const [name, value] of entries) headers.set(name, value);
  return { ...init, headers };
}

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;

/** The request's headers with the authenticator's merged over them; the authenticator's win. */
async function authorizedHeaders(
  init: RequestInit | undefined,
  admitted: IMCPAdmittedHttpEndpoint,
  bound: IMCPBoundAuthenticator,
): Promise<{ headers: Headers; credential: Readonly<Record<string, string>> }> {
  try {
    init?.signal?.throwIfAborted();
    const credential = await bound.authenticator.authorize({
      serverId: bound.serverId,
      securityIdentity: bound.securityIdentity,
      url: admitted.url,
      ...(init?.signal ? { signal: init.signal } : {}),
    });
    init?.signal?.throwIfAborted();
    const headers = new Headers(init?.headers);
    // Inside the try: an invalid header value makes `Headers` throw an error that quotes it.
    for (const [name, value] of Object.entries(credential)) headers.set(name, value);
    return { headers, credential };
  } catch {
    // Reported without the authenticator's or the platform's text, which may quote a credential.
    // A cancelled request stays a cancellation.
    if (init?.signal?.aborted === true) {
      throw new DOMException('The MCP request was cancelled', 'AbortError');
    }
    throw new MCPAuthenticationError('authorize-failed');
  }
}

/**
 * Send one request, authorized when the admitted endpoint has an authenticator. A 401/403 is
 * retried at most once with fresh authorization, and only when the authenticator allows it and
 * the body can be sent again; there is never an unauthenticated attempt.
 */
async function fetchAuthenticated(
  send: (headers: Headers | undefined) => Promise<Response>,
  init: RequestInit | undefined,
  admitted: IMCPAdmittedHttpEndpoint,
): Promise<Response> {
  const bound = admitted.authentication;
  if (bound === undefined) return send(undefined);
  const refused = (response: Response): boolean =>
    response.status === HTTP_UNAUTHORIZED || response.status === HTTP_FORBIDDEN;
  const authorized = await authorizedHeaders(init, admitted, bound);
  const first = await send(authorized.headers);
  if (!refused(first)) return first;
  const wwwAuthenticate = first.headers.get('www-authenticate');
  // The refusal's body is never read; release the connection now rather than at collection.
  await first.body?.cancel().catch(() => undefined);
  init?.signal?.throwIfAborted();
  let answer: 'retry' | 'fail';
  try {
    answer = await bound.authenticator.onRejected({
      status: first.status,
      ...(wwwAuthenticate === null ? {} : { wwwAuthenticate }),
      authorization: authorized.credential,
    });
  } catch {
    answer = 'fail';
  }
  const replayable =
    init?.body === undefined || init.body === null || typeof init.body === 'string';
  if (answer !== 'retry' || !replayable) throw new MCPAuthenticationError('rejected');
  const second = await send((await authorizedHeaders(init, admitted, bound)).headers);
  if (refused(second)) {
    await second.body?.cancel().catch(() => undefined);
    throw new MCPAuthenticationError('rejected');
  }
  return second;
}

export function constructStreamableHttpTransport(
  admitted: IMCPAdmittedHttpEndpoint,
  deps: IMCPHttpTransportDeps = {},
): StreamableHTTPClientTransport {
  const admittedUrl = admitted.url.toString();
  // Snapshot the endpoint before async authorization; later owner-object mutation cannot retarget a request.
  const boundEndpoint = {
    ...admitted,
    url: new URL(admittedUrl),
    headers: Object.freeze({ ...admitted.headers }),
  };
  const lookup = boundEndpoint.egress?.lookup ?? deps.lookup;
  const carrier = createMcpPinnedFetch(
    admittedUrl,
    boundEndpoint.egress?.policy ?? deps.policy ?? {},
    {
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
      ...(lookup ? { lookup } : {}),
    },
  );
  const baseFetch = carrier.fetch;
  const callTraces = new MCPCallTraceRegistry();

  // The admitted URL is the only URL spoken to: every call this transport makes is forced to
  // `redirect: 'manual'` (never trusting the SDK's default of following one), and any 3xx response
  // from the admitted origin is refused rather than chased to a second, un-admitted destination.
  const redirectRefusingFetch: typeof globalThis.fetch = async (input, init) => {
    carrier.signal.throwIfAborted();
    const signals = [carrier.signal];
    if (init?.signal) signals.push(init.signal);
    const toolSignal = callRequestSignal(init);
    if (toolSignal) signals.push(toolSignal);
    const signal = AbortSignal.any(signals);
    let effectiveInit = init;
    if (new Headers(init?.headers).get('mcp-protocol-version') === '2026-07-28') {
      // A legacy SDK may remember an unsolicited session header; stateless requests cannot inherit it.
      const headers = new Headers(init?.headers);
      headers.delete('mcp-session-id');
      effectiveInit = { ...init, headers };
      if (init?.method !== 'POST')
        throw new Error('Stateless MCP automatic stream resumption is unavailable');
    }
    const traced = withTraceHeaders(
      { ...effectiveInit, signal },
      callTraceHeaders(effectiveInit, admittedUrl, callTraces),
    );
    const response = await fetchAuthenticated(
      (headers) =>
        baseFetch(input, { ...traced, ...(headers ? { headers } : {}), redirect: 'manual' }),
      traced,
      boundEndpoint,
    );
    if (
      response.status >= HTTP_REDIRECT_STATUS_MIN &&
      response.status < HTTP_REDIRECT_STATUS_MAX_EXCLUSIVE
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new MCPTransportRedirectRefusedError(
        response.status,
        response.headers.get('location') ?? undefined,
        admittedUrl,
      );
    }
    const resourceRead =
      typeof init?.body === 'string' && JSON.parse(init.body).method === 'resources/read';
    const maxBytes =
      resourceRead && skillReceiveBudgetEnabled(transport)
        ? SKILL_RESOURCE_RECEIVE_BYTES
        : DEFAULT_MCP_RECEIVE_BYTES;
    return boundResponseBody(response, maxBytes);
  };

  const transport = new TracingStreamableHTTPClientTransport(
    boundEndpoint.url,
    {
      requestInit: {
        redirect: 'manual',
        ...(Object.keys(boundEndpoint.headers).length > 0
          ? { headers: boundEndpoint.headers }
          : {}),
      },
      fetch: redirectRefusingFetch,
    },
    callTraces,
    () => carrier.close(),
  );
  bindCallTraceRegistry(transport, callTraces);
  return transport;
}

/** The HTTP adapter; `createStdioAdapter` is a second value of the same type. */
export function createStreamableHttpAdapter(
  deps: IMCPHttpTransportDeps = {},
): IMCPTransportAdapter<IMCPHttpEndpoint, IMCPAdmittedHttpEndpoint> {
  return {
    kind: 'streamable-http',
    admit: (endpoint) => admitHttpEndpoint(endpoint, deps),
    construct: (admitted) => constructStreamableHttpTransport(admitted, deps),
  };
}
