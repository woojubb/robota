/**
 * What every product surface may be in secure mode, and the one gate every listener opens through.
 *
 * Any program running as the same user can connect to every local socket and port, so in secure mode
 * a listener that admits by a token, a login or "same user" admits that program too. The table gives
 * each surface (a way the product runs, or a listener it opens) its plain disposition, which plain
 * mode keeps, and its secure one. It is exhaustive over the surface unions, so a surface added
 * without a decision fails to build. Product code opens a listener only through `startListener`,
 * whose first argument is the listener's row, so no listener starts without one; the listener-sites
 * scan test names every place in product code that opens one and the row it belongs to.
 *
 * Plain mode never reads a secure disposition: `startListener` opens exactly what it opened before.
 */
import { productSecureMode } from '../product/session-sealing.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** The ways a product process runs. */
export const PROCESS_SURFACES = ['tui', 'print', 'acp', 'mcp-stdio', 'supervised-runtime'] as const;
export type TProcessSurface = (typeof PROCESS_SURFACES)[number];

/** The listeners a product process opens. */
export const LISTENER_SURFACES = [
  'control-socket',
  'websocket-transport',
  'serve-http',
  'serve-monitor',
  'mcp-http',
  'external-events',
  'hosted-ingress',
  'hosted-desktop-gateway',
  'desktop-remote-bridge',
  'local-peers',
  'remote-control',
  'device-mesh',
  'oauth-callback',
] as const;
export type TListenerSurface = (typeof LISTENER_SURFACES)[number];

export type TProductSurface = TProcessSurface | TListenerSurface;

/**
 * How a process surface admits in secure mode. `own-process`: it builds its own stores, and its peer
 * (a terminal, or the program that spawned it on stdio) reaches nothing else; `unlock` says whether a
 * person can ever be asked for the passphrase there, which only a product-owned terminal allows.
 * `owner-link`: it is reachable only through owner links on its control endpoint and unlocked only by
 * a read grant.
 */
export type TProcessDisposition =
  | { readonly admit: 'own-process'; readonly unlock: 'terminal' | 'never' }
  | { readonly admit: 'owner-link'; readonly unlock: 'grant' };

/**
 * How a listener admits in secure mode. `owner-link`: it opens, and admits open commands plus owner
 * links only. `oauth-callback`: it opens under the callback rule its plain disposition states.
 * `none`: it does not start, and `reason` is the fixed product copy it is refused with.
 */
export type TListenerDisposition =
  | { readonly admit: 'owner-link' }
  | { readonly admit: 'oauth-callback' }
  | { readonly admit: 'none'; readonly reason: string };

export interface ISurfaceRule<TSurface extends TProductSurface, TDisposition> {
  readonly surface: TSurface;
  /** How the surface admits in plain mode, which secure mode does not change. */
  readonly plain: string;
  readonly secure: TDisposition;
}

/** A listener's row: what `startListener` takes, so a process surface can never be opened as one. */
export type TListenerRule = ISurfaceRule<TListenerSurface, TListenerDisposition>;

type TSecureSurfaces = {
  readonly [S in TProcessSurface]: ISurfaceRule<S, TProcessDisposition>;
} & {
  readonly [S in TListenerSurface]: ISurfaceRule<S, TListenerDisposition>;
};

const ONLY_YOU = 'and secure mode admits only you, by proof. Use the terminal or the desktop app.';

export const SECURE_SURFACES: TSecureSurfaces = {
  tui: {
    surface: 'tui',
    plain: 'Runs at the terminal that started it.',
    secure: { admit: 'own-process', unlock: 'terminal' },
  },
  print: {
    surface: 'print',
    plain: 'Runs one prompt for the program that started it.',
    // It writes sealed and never reads what it did not write, so it never needs a secret.
    secure: { admit: 'own-process', unlock: 'never' },
  },
  acp: {
    surface: 'acp',
    plain: 'Serves the editor that started it, over stdio.',
    // The editor and its extensions are other programs of this user: never asked, never unlocked.
    secure: { admit: 'own-process', unlock: 'never' },
  },
  'mcp-stdio': {
    surface: 'mcp-stdio',
    plain: 'Serves the MCP client that started it, over stdio.',
    secure: { admit: 'own-process', unlock: 'never' },
  },
  'supervised-runtime': {
    surface: 'supervised-runtime',
    plain:
      'A daemon, desktop runtime or background session; clients reach it through its control socket and WebSocket transport.',
    secure: { admit: 'owner-link', unlock: 'grant' },
  },
  'control-socket': {
    surface: 'control-socket',
    plain:
      'An owner-only socket in a private directory (a protected named pipe on Windows); every command is open to programs of this user, and `connect` hands out the WebSocket token.',
    secure: { admit: 'owner-link' },
  },
  'websocket-transport': {
    surface: 'websocket-transport',
    plain: 'A loopback WebSocket admitted by the launch token, with Host and Origin checked.',
    secure: {
      admit: 'none',
      reason: `The WebSocket transport does not start in secure mode: it admits whoever holds its token, ${ONLY_YOU}`,
    },
  },
  'serve-http': {
    surface: 'serve-http',
    plain:
      'HTTP admitted by a bearer token on loopback, or by OAuth access tokens as a remote resource server.',
    secure: {
      admit: 'none',
      reason: `The served HTTP API does not start in secure mode: it admits whoever holds its token or login, ${ONLY_YOU}`,
    },
  },
  'serve-monitor': {
    surface: 'serve-monitor',
    plain: 'Loopback HTTP serving the monitor page, which carries the WebSocket URL and its token.',
    secure: {
      admit: 'none',
      reason: `The browser monitor does not start in secure mode: it hands out the WebSocket token, ${ONLY_YOU}`,
    },
  },
  'mcp-http': {
    surface: 'mcp-http',
    plain:
      'MCP over HTTP admitted by a bearer token from an owner-only file on loopback, or by OAuth access tokens as a remote resource server.',
    secure: {
      admit: 'none',
      reason: `MCP over HTTP does not start in secure mode: it admits whoever holds its token or login, ${ONLY_YOU} MCP over stdio still works.`,
    },
  },
  'external-events': {
    surface: 'external-events',
    plain: 'Loopback HTTP; each grant admits by a bearer derived from its grant file.',
    secure: {
      admit: 'none',
      // An injected turn in a session the owner unlocked would be tagged as the owner's.
      reason:
        'External events do not start in secure mode: a grant file any program of yours can rewrite admits them, and what they deliver would be marked as yours.',
    },
  },
  'hosted-ingress': {
    surface: 'hosted-ingress',
    plain:
      "A loopback relay to a hosted worker's serve port, admitted by the worker's serve token.",
    secure: {
      admit: 'none',
      reason: `The hosted serve relay does not start in secure mode: it admits whoever holds the worker's token, ${ONLY_YOU}`,
    },
  },
  'hosted-desktop-gateway': {
    surface: 'hosted-desktop-gateway',
    plain:
      'Attaches to a server its deployer opens, and admits paired desktops by bearer tokens the deployment authorizes.',
    secure: {
      admit: 'none',
      reason: `The hosted desktop gateway does not start in secure mode: it admits whoever holds a desktop token, ${ONLY_YOU}`,
    },
  },
  'desktop-remote-bridge': {
    surface: 'desktop-remote-bridge',
    plain:
      'A loopback WebSocket from the desktop window to a remote runtime, admitted by a per-launch token.',
    secure: {
      admit: 'none',
      reason: `Desktop remote mode does not start in secure mode: its bridge admits whoever holds its token, ${ONLY_YOU}`,
    },
  },
  'local-peers': {
    surface: 'local-peers',
    plain:
      'Unix sockets in an owner-only directory; any session of this user on this host is admitted.',
    secure: {
      admit: 'none',
      reason:
        'Local peers cannot be used with secure mode yet: they admit any program of yours on this machine.',
    },
  },
  'remote-control': {
    surface: 'remote-control',
    plain: 'WebRTC data channels to paired devices, set up through the signaling relay.',
    secure: {
      admit: 'none',
      reason:
        'Remote control cannot be used with secure mode yet: paired devices are not proven against your keyring.',
    },
  },
  'device-mesh': {
    surface: 'device-mesh',
    plain:
      'A LAN WebSocket listener, a UDP TURN relay, the DHT, mDNS and WebRTC peers; linked devices are admitted by the device identity lists.',
    secure: {
      admit: 'none',
      reason:
        'The device mesh cannot be used with secure mode yet: linked devices are not proven against your keyring.',
    },
  },
  'oauth-callback': {
    surface: 'oauth-callback',
    plain:
      'Loopback only, on an ephemeral or the configured callback port; bound by a fresh path or a required state; the first matching request consumes it; it times out and reaches no session.',
    secure: { admit: 'oauth-callback' },
  },
};

/** A listener whose row refuses it in secure mode. Nothing was bound. */
export class SecureSurfaceRefusedError extends Error {
  constructor(
    readonly surface: TListenerSurface,
    reason: string,
  ) {
    super(reason);
    this.name = 'SecureSurfaceRefusedError';
  }
}

/**
 * Open a listener under its row. In plain mode this is `open()` itself, so the listener binds, fails
 * and resolves exactly as it did before the gate existed. In secure mode a refused row is a rejected
 * promise (never a throw, so a caller that only attaches `.catch` still sees it) and `open` never
 * runs; how each surface reports that is the surface's own decision.
 */
export function startListener<T>(
  rule: TListenerRule,
  runtime: ICliRuntimeContext,
  open: () => Promise<T>,
): Promise<T> {
  if (productSecureMode(runtime) && rule.secure.admit === 'none') {
    return Promise.reject(new SecureSurfaceRefusedError(rule.surface, rule.secure.reason));
  }
  return open();
}
