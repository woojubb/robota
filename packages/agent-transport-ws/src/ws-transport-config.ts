/**
 * The construction contract for `WsTransport` — what a caller decides before the server exists.
 *
 * Split from `ws-transport-configurable.ts` under the file-size ceiling, and the seam is the
 * honest one: everything here is a decision the CALLER makes (port, retries, admission — SEC-008's
 * `token`/`open`/`openReason` contract lives in these doc comments), while the class next door is
 * what the transport DOES with those decisions.
 */

export const DEFAULT_PORT = 7070;
export const DEFAULT_MAX_RETRIES = 20;

export interface IWsTransportConfig {
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
