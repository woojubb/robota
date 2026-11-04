/**
 * The Node host's HTTP network for an MCP server: the shared egress policy of
 * `@robota-sdk/agent-core/node`, which resolves names, refuses loopback, private and metadata
 * addresses, and connects only to the addresses it checked.
 */
import { rejectDestination } from '@robota-sdk/agent-core/node';

import { createNodeCallContext } from './call-context.js';
import { createMcpPinnedFetch } from './pinned-http-fetch.js';

import type { IMCPHttpEgress } from '../client/http-egress.js';
import type { IMCPHttpTransportDeps } from '../client/transport.js';
import type { IEgressPolicy, TEgressLookup } from '@robota-sdk/agent-core/node';

export interface INodeHttpEgressOptions {
  /** Egress policy; default refuses private, loopback and metadata destinations. */
  readonly policy?: IEgressPolicy;
  /** Hostname resolver injected so tests never touch DNS. */
  readonly lookup?: TEgressLookup;
  /**
   * Trusted owner/test carrier. Every request is still judged first; this only replaces the
   * connection, so it owns its connection policy instead of the default's pinning guarantee.
   */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The policy and resolver are copied here, so a later change to the objects passed in cannot change
 * what an endpoint admitted under this egress may reach.
 */
export function createNodeHttpEgress(options: INodeHttpEgressOptions = {}): IMCPHttpEgress {
  const policy = Object.freeze({
    ...options.policy,
    ...(options.policy?.allowedHosts
      ? { allowedHosts: Object.freeze([...options.policy.allowedHosts]) }
      : {}),
  });
  const lookup = options.lookup;
  const fetch = options.fetch;
  return {
    admit: async (url) => {
      const rejection = lookup
        ? await rejectDestination(url, policy, lookup)
        : await rejectDestination(url, policy);
      return rejection === undefined
        ? undefined
        : { reason: rejection.reason, message: rejection.message };
    },
    open: (endpoint) =>
      createMcpPinnedFetch(endpoint, policy, {
        ...(fetch ? { fetch } : {}),
        ...(lookup ? { lookup } : {}),
      }),
  };
}

/**
 * Everything the HTTP transport needs from a Node host in one value: the egress that pins sockets
 * and refuses private destinations, and the `AsyncLocalStorage` call context that ties a tool call
 * to its own request. A Node composition root passes this wherever it composes the transport.
 */
export function createNodeHttpTransportDeps(
  options: INodeHttpEgressOptions = {},
): IMCPHttpTransportDeps {
  return { egress: createNodeHttpEgress(options), callContext: createNodeCallContext() };
}
