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
  return new StreamableHTTPClientTransport(admitted.url, {
    requestInit:
      Object.keys(admitted.headers).length > 0 ? { headers: admitted.headers } : undefined,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
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
