import { createRequire } from 'node:module';

import type { RTCPeerConnection } from 'werift';

/** The subset of the `werift` module surface this transport constructs. */
export interface IWeriftModule {
  RTCPeerConnection: new (configuration?: {
    // REMOTE-010: werift's ICE gatherer consumes only a SINGLE-string `urls` (array urls / `turns:` are silently
    // dropped by its `parseIceServers`); TURN servers carry username/credential. Relay-only comes from
    // `iceTransportPolicy:'relay'` — werift IGNORES a top-level `forceTurn`, so this type must NOT declare it.
    iceServers?: { urls: string; username?: string; credential?: string }[];
    iceTransportPolicy?: 'all' | 'relay';
  }) => RTCPeerConnection;
}

/**
 * Lazily load the optional `werift` (pure-TypeScript WebRTC) peer dependency (REMOTE-002). `werift` is kept
 * OUT of the transport's runtime dependency graph (peer + optional) so this package is importable without it;
 * absence surfaces an **explicit "WebRTC transport unavailable" error at point-of-use** (a throw, mirroring
 * `agent-cli`'s `loadReplayProvider`) — never a silent no-op or degraded path (no-fallback rule). The
 * werift-vs-native choice is a recorded design decision, not a runtime fallback.
 */
/** Resolve a module by id. The default resolves the real `werift`; tests inject a throwing resolver. */
export type TModuleResolver = (id: string) => unknown;

const defaultResolver: TModuleResolver = (id) => {
  const requireFrom = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional peer; must resolve at runtime, not bundle
  return requireFrom(id);
};

export function loadWerift(resolve: TModuleResolver = defaultResolver): IWeriftModule {
  try {
    return resolve('werift') as IWeriftModule;
  } catch {
    throw new Error(
      'WebRTC transport unavailable — install the optional peer dependency "werift" to use @robota-sdk/agent-transport-webrtc.',
    );
  }
}
