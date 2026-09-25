/**
 * Where a provider sends what it is given: its type and the host it talks to.
 *
 * The advisor asks for consent per destination and skips asking only when the advisor goes where the
 * main model already sends the conversation. A provider type alone cannot answer that — one type can
 * front a local server and a vendor's cloud — so the destination is remembered for each provider
 * instance when it is built from its settings.
 */

import { findProviderDefinition } from '@robota-sdk/agent-core';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';

const DEFAULT_PORTS = new Set(['80', '443']);

function withPort(hostname: string, port: string | number | undefined): string {
  const text = port === undefined ? '' : String(port);
  const host = hostname.toLowerCase();
  return text.length === 0 || DEFAULT_PORTS.has(text) ? host : `${host}:${text}`;
}

function hostOf(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    return withPort(parsed.hostname, parsed.port);
  } catch {
    // allow-fallback: an unparsable base URL is still a distinct destination, named as written
    return trimmed.toLowerCase();
  }
}

/**
 * `<type>@<host>`: the configured base URL's host, else the type's default base URL or endpoint. A
 * default port (80, 443) is left out, so one endpoint always has one name.
 */
export function describeProviderDestination(
  config: { readonly name: string; readonly baseURL?: string },
  providerDefinitions: readonly IProviderDefinition[],
): string {
  const definition = findProviderDefinition(providerDefinitions, config.name);
  const url = config.baseURL ?? definition?.defaults?.baseURL;
  const host =
    url !== undefined && url.length > 0
      ? hostOf(url)
      : definition?.endpoint !== undefined
        ? withPort(definition.endpoint.host, definition.endpoint.port)
        : 'default';
  return `${definition?.type ?? config.name}@${host}`;
}

const destinations = new WeakMap<IAIProvider, string>();

/** Record where `provider` sends requests; called where the provider is built from its settings. */
export function rememberProviderDestination(provider: IAIProvider, destination: string): void {
  destinations.set(provider, destination);
}

/** Where `provider` sends requests, when that was recorded; otherwise unknown. */
export function providerDestinationOf(provider: IAIProvider): string | undefined {
  return destinations.get(provider);
}
