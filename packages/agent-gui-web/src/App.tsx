import { CenteredChrome, SessionSurface, useWsSession } from '@robota-sdk/agent-ui-web/client';
import { useEffect, useState } from 'react';

import type { IGuiHost } from './gui-host.js';

/**
 * The GUI compose-root: a thin binding over the GUI presentation core (`@robota-sdk/agent-ui-web`). It
 * owns NO session/command/permission logic — the sidecar owns everything below the wire, and the host
 * (desktop bridge or browser page) only says where that sidecar is.
 */

/** Connect to the sidecar over WS and render the shared session surface. */
function SessionView({ url, host }: { url: string; host: IGuiHost }): React.ReactElement {
  const state = useWsSession(url);
  useEffect(() => {
    if (state.status === 'connected') host.signalReady();
  }, [state.status, host]);
  return <SessionSurface state={state} surface={host.kind === 'desktop' ? 'app' : 'web'} personalUsageEnabled />;
}

/** Resolve the endpoint from the host, watch for a fatal sidecar state, then mount. */
export function App({ host }: { host: IGuiHost }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);

  useEffect(() => {
    void host.getEndpoint().then(setUrl);
    return host.onState((state) => {
      if (state === 'fatal') setFatal(true);
    });
  }, [host]);

  if (fatal) {
    return (
      <div role="alert" className="h-full">
        <CenteredChrome tone="fatal">
          The agent process stopped. Personal Usage is unavailable. Restart the app to reconnect.
        </CenteredChrome>
      </div>
    );
  }
  if (!url) {
    return <CenteredChrome tone="muted">Starting the agent…</CenteredChrome>;
  }
  return <SessionView url={url} host={host} />;
}
