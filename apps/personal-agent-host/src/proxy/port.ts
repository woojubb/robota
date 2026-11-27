/**
 * The proxy port: the control plane states every site that should exist, as plain JSON, and the
 * proxy makes exactly that so. A hostname that is not in the list is not served and gets no
 * certificate.
 */
export type ProxySite =
  /** Proxied to the unit's own endpoints, as `host:port`. */
  | { kind: 'active'; hostname: string; guiUpstream: string; wsUpstream: string }
  /** The account is suspended: answered with 503, never proxied. */
  | { kind: 'suspended'; hostname: string }
  /** The account should be running but its unit is not: answered with 503. */
  | { kind: 'unavailable'; hostname: string };

export interface IProxyApplied {
  /** Identifies the applied configuration, for comparison in status output. */
  hash: string;
}

export interface IProxyPort {
  apply(sites: readonly ProxySite[]): Promise<IProxyApplied>;
}
