/**
 * Transport seam: ADMIT, then CONSTRUCT (spec § Decision, MCP-002).
 *
 * Every transport contributes a typed admission step whose result is the only thing the
 * constructor accepts. HTTP admits a URL through the shared egress policy (SSRF boundary owned by
 * `@robota-sdk/agent-core/node`); a stdio adapter (MCP-2522) admits an executable, an environment
 * allowlist and a cwd authority in the same slot. Nothing here opens a connection: constructing an
 * SDK transport is inert until a `Client` connects it.
 *
 * The transport set of THIS unit is exactly Streamable HTTP (TC-06). The deprecated HTTP+SSE binding
 * and custom socket bindings are refusals surfaced in the catalog, not adapters.
 */

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rejectDestination } from '@robota-sdk/agent-core/node';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
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
}

export interface IMCPAdmittedHttpEndpoint {
  readonly kind: 'streamable-http';
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
}

export interface IMCPHttpTransportDeps {
  /** Egress policy; default refuses private, loopback and metadata destinations. */
  readonly policy?: IEgressPolicy;
  /** Hostname resolver injected so tests never touch DNS. */
  readonly lookup?: TEgressLookup;
  /** Fetch used by the SDK transport; default is the global one. */
  readonly fetch?: typeof globalThis.fetch;
}

const POLICY_REFUSAL = 'egress-policy';

/** Inclusive HTTP redirect status range (300–399). */
const HTTP_REDIRECT_STATUS_MIN = 300;
const HTTP_REDIRECT_STATUS_MAX_EXCLUSIVE = 400;

/**
 * The admitted URL is the only URL spoken to — a redirect is REFUSED, never followed. Thrown by the
 * fetch wrapper `constructStreamableHttpTransport` installs when the admitted origin responds with
 * any 3xx: following it would hand the request's headers (set by the caller as trusted for the
 * admitted origin) to a second, un-admitted destination, defeating the whole point of admission.
 */
export class MCPTransportRedirectRefusedError extends Error {
  constructor(
    readonly status: number,
    readonly location: string | undefined,
    admittedUrl: string,
  ) {
    super(
      `Streamable HTTP transport refused a redirect (${status}) from ${admittedUrl} to ` +
        `${location ?? 'an undisclosed location'}: the admitted URL is the only URL spoken to`,
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
  if (!URL.canParse(endpoint.url)) {
    return { ok: false, reason: 'invalid-url', message: `Not a URL: ${endpoint.url}` };
  }
  const url = new URL(endpoint.url);
  const rejection = deps.lookup
    ? await rejectDestination(url, deps.policy ?? {}, deps.lookup)
    : await rejectDestination(url, deps.policy ?? {});
  if (rejection) {
    return {
      ok: false,
      reason: `${POLICY_REFUSAL}:${rejection.reason}`,
      message: rejection.message,
    };
  }
  return {
    ok: true,
    admitted: { kind: 'streamable-http', url, headers: { ...(endpoint.headers ?? {}) } },
  };
}

export function constructStreamableHttpTransport(
  admitted: IMCPAdmittedHttpEndpoint,
  deps: IMCPHttpTransportDeps = {},
): StreamableHTTPClientTransport {
  const baseFetch = deps.fetch ?? globalThis.fetch;
  const admittedUrl = admitted.url.toString();

  // The admitted URL is the only URL spoken to: every call this transport makes is forced to
  // `redirect: 'manual'` (never trusting the SDK's default of following one), and any 3xx response
  // from the admitted origin is refused rather than chased to a second, un-admitted destination.
  const redirectRefusingFetch: typeof globalThis.fetch = async (input, init) => {
    const response = await baseFetch(input, { ...init, redirect: 'manual' });
    if (
      response.status >= HTTP_REDIRECT_STATUS_MIN &&
      response.status < HTTP_REDIRECT_STATUS_MAX_EXCLUSIVE
    ) {
      throw new MCPTransportRedirectRefusedError(
        response.status,
        response.headers.get('location') ?? undefined,
        admittedUrl,
      );
    }
    return response;
  };

  return new StreamableHTTPClientTransport(admitted.url, {
    requestInit: {
      redirect: 'manual',
      ...(Object.keys(admitted.headers).length > 0 ? { headers: admitted.headers } : {}),
    },
    fetch: redirectRefusingFetch,
  });
}

/** The one adapter this unit ships. A stdio adapter is a second value of the same type. */
export function createStreamableHttpAdapter(
  deps: IMCPHttpTransportDeps = {},
): IMCPTransportAdapter<IMCPHttpEndpoint, IMCPAdmittedHttpEndpoint> {
  return {
    kind: 'streamable-http',
    admit: (endpoint) => admitHttpEndpoint(endpoint, deps),
    construct: (admitted) => constructStreamableHttpTransport(admitted, deps),
  };
}
