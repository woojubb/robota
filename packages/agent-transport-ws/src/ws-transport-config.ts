/**
 * The construction contract for `WsTransport` — what a caller decides before the server exists.
 *
 * Split from `ws-transport-configurable.ts` under the file-size ceiling, and the seam is the
 * honest one: everything here is a decision the CALLER makes (port, retries, admission — SEC-008's
 * `token`/`open`/`openReason` contract lives in these doc comments), while the class next door is
 * what the transport DOES with those decisions.
 */

import type { TUsageSurface } from '@robota-sdk/agent-interface-analytics';
import type { TDriverId } from '@robota-sdk/agent-interface-session';
import type { ITransportLifecycleError } from '@robota-sdk/agent-interface-transport';
import type { IWsHandlerOptions } from '@robota-sdk/agent-transport-protocol';

export const DEFAULT_PORT = 7070;
export const DEFAULT_MAX_RETRIES = 20;

export interface IWsTransportConfig {
  /** Trusted server-assigned identity for turns submitted over this product surface. */
  driverId?: TDriverId;
  /** Trusted product surface, independent from the connection's driver identity. */
  surface?: TUsageSurface;
  /** Host-owned cross-session usage read model, forwarded unchanged to the protocol handler. */
  personalUsageReporter?: IWsHandlerOptions['personalUsageReporter'];
  /** Host-owned current-session trace/cost producer, forwarded unchanged to the protocol handler. */
  usageReporter?: IWsHandlerOptions['usageReporter'];
  /** Host-owned stored-session trace/cost producer for personal-usage drill-down. */
  storedSessionUsageReporter?: IWsHandlerOptions['storedSessionUsageReporter'];
  port?: number;
  maxRetries?: number;
  /**
   * OPTIONAL explicit loopback auth token. When set, every connection MUST present a matching token
   * (query param `?token=` or the `Sec-WebSocket-Protocol` subprotocol) or the socket is closed BEFORE any
   * session data is emitted (GUI-002; the GUI sidecar sets `ROBOTA_WS_TOKEN`). SEC-001: when this is unset
   * AND `open` is not `true`, the transport AUTO-MINTS a random per-launch token (secure by default) —
   * `resolvedToken` exposes it so the surface can deliver it to the co-located client (a `0600` connection
   * file / the served monitor's injected `ws-url`). An explicit token here wins over the auto-mint — but NOT
   * over `open`: SEC-008 makes a token together with `open: true` a contradiction that throws, rather
   * than a precedence one side quietly wins.
   */
  token?: string;
  /**
   * SEC-001 discouraged opt-out: when `true`, run WITHOUT auth (no token, no auto-mint) — the pre-SEC-001
   * open loopback behavior. NOT RECOMMENDED (any local process or browser page can then drive+authorize the
   * session); mirrors Jupyter's `c.ServerApp.token = ''`.
   *
   * SEC-008: `open: true` together with a non-empty `token` is REJECTED, not resolved by precedence. The
   * two ask for opposite things, and picking a winner silently is how a caller ends up with the admission
   * it did not choose. `resolveAdmission` decides that for every transport, so they cannot differ.
   */
  open?: boolean;
  /** SEC-008: why running with no credential is correct here. Required when `open` is true. */
  openReason?: string;
  /**
   * SEC-001 defense-in-depth: extra host names (beyond `localhost`/`127.0.0.1`/`::1`) accepted in the
   * upgrade `Host` header. The `Host` allow-list closes DNS-rebinding independently of the token.
   */
  allowedHosts?: readonly string[];
  /**
   * SEC-001 defense-in-depth: extra browser `Origin`s (beyond loopback) accepted on the upgrade — e.g. the
   * `apps/agent-web` app origin. A browser sends an unforgeable `Origin`; a non-browser client omits it (and
   * is gated by the token instead). Closes the "any web page in any browser" hole before history is emitted.
   */
  allowedOrigins?: readonly string[];
}

type TUsageReporters = Pick<
  IWsHandlerOptions,
  'personalUsageReporter' | 'usageReporter' | 'storedSessionUsageReporter'
>;

/** Remove absent reporters so exact-optional handler options remain truthful. */
export function configuredUsageReporters(config: IWsTransportConfig): TUsageReporters {
  return {
    ...(config.personalUsageReporter
      ? { personalUsageReporter: config.personalUsageReporter }
      : {}),
    ...(config.usageReporter ? { usageReporter: config.usageReporter } : {}),
    ...(config.storedSessionUsageReporter
      ? { storedSessionUsageReporter: config.storedSessionUsageReporter }
      : {}),
  };
}

export function validTransportOptions(options: Readonly<Record<string, unknown>>): boolean {
  const { port, maxRetries } = options;
  if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) return false;
  return maxRetries === undefined || (typeof maxRetries === 'number' && maxRetries >= 0);
}

export function transportLifecycleError(
  transportName: string,
  code: ITransportLifecycleError['code'],
): ITransportLifecycleError {
  return Object.assign(new Error(`${transportName} ${code}.`), {
    name: 'TransportLifecycleError' as const,
    code,
    transportName,
  });
}
