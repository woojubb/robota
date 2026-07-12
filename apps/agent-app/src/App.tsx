import {
  CenteredChrome,
  SessionSurface,
  useWsSession,
} from '@robota-sdk/agent-transport-gui/client';
import { useEffect, useState } from 'react';

import type { TSidecarState } from '../electron/sidecar.js';

/**
 * GUI-005 renderer compose-root. Mirrors the TUI/`RemoteClient` pattern: the desktop app is a thin binding
 * over the GUI presentation core (`@robota-sdk/agent-transport-gui`) — it owns NO session/command/permission
 * logic. The loopback endpoint (with the auth token) comes from the Electron preload bridge; the sidecar owns
 * everything below the wire. The layout/components (SessionSurface, chrome) belong to the shared GUI core, the
 * GUI analog of how the TUI presentation lives in `agent-transport-tui`.
 */

/** Thin wire binding: connect to the loopback sidecar over WS and render the shared desktop surface. */
function SessionView({ url }: { url: string }): React.ReactElement {
  const state = useWsSession(url);
  useEffect(() => {
    if (state.status === 'connected') window.agentGui.signalReady();
  }, [state.status]);
  return <SessionSurface state={state} surface="app" />;
}

/** Top-level: resolve the endpoint from the preload bridge, watch for a fatal sidecar state, then mount. */
export function App(): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [fatal, setFatal] = useState<TSidecarState | null>(null);

  useEffect(() => {
    void window.agentGui.getEndpoint().then(setUrl);
    const off = window.agentGui.onState((s) => {
      if (s === 'fatal') setFatal('fatal');
    });
    return off;
  }, []);

  if (fatal) {
    return (
      <div role="alert" className="h-full">
        <CenteredChrome tone="fatal">
          The agent process stopped. Restart the app to reconnect.
        </CenteredChrome>
      </div>
    );
  }
  if (!url) {
    return <CenteredChrome tone="muted">Starting the agent…</CenteredChrome>;
  }
  return <SessionView url={url} />;
}
