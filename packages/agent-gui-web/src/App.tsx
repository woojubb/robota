import { CenteredChrome, SessionSurface, useWsSession } from '@robota-sdk/agent-ui-web/client';
import { useCallback, useEffect, useState } from 'react';

import type { IGuiHost } from './gui-host.js';

/**
 * The GUI compose-root: a thin binding over the GUI presentation core (`@robota-sdk/agent-ui-web`). It
 * owns NO session/command/permission logic — the sidecar owns everything below the wire, and the host
 * (desktop bridge or browser page) only says where that sidecar is.
 */

/** Connect to the sidecar over WS and render the shared session surface. */
function SessionView({
  url,
  host,
  onConnectionLost,
}: {
  url: string;
  host: IGuiHost;
  onConnectionLost: () => void;
}): React.ReactElement {
  const state = useWsSession(url, { onConnectionLost });
  useEffect(() => {
    if (state.status === 'connected') host.signalReady();
  }, [state.status, host]);
  return (
    <SessionSurface
      state={state}
      surface={host.kind === 'desktop' ? 'app' : 'web'}
      personalUsageEnabled
    />
  );
}

/**
 * The runtime went away while the page was attached, and the host can bring it back: say so, and offer
 * to reconnect. The host reloads the page once the runtime is back (or into the fatal screen, with the
 * reason, when it could not start).
 */
function RuntimeStopped({ restart }: { restart: () => Promise<void> }): React.ReactElement {
  const [reconnecting, setReconnecting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const reconnect = (): void => {
    setReconnecting(true);
    setFailed(null);
    restart().catch((error: unknown) => {
      setReconnecting(false);
      setFailed(error instanceof Error ? error.message : String(error));
    });
  };
  return (
    <div role="alert" className="flex h-full flex-col">
      <CenteredChrome tone="fatal">
        The agent process stopped, and the connection to it was lost.
        <div className="mt-4">
          <button
            type="button"
            onClick={reconnect}
            disabled={reconnecting}
            className="rounded-lg bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
        {failed ? <p className="mt-3 text-[13px] text-destructive">{failed}</p> : null}
      </CenteredChrome>
    </div>
  );
}

/** Resolve the endpoint from the host, watch for a fatal sidecar state, then mount. */
export function App({ host }: { host: IGuiHost }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  // `detail` is what the sidecar said before it stopped — the reason, and often the fix.
  const [fatal, setFatal] = useState<{ detail?: string } | null>(null);
  // The page's connection ran out of retries: the runtime is not coming back by itself.
  const [lost, setLost] = useState(false);
  const onConnectionLost = useCallback(() => setLost(true), []);

  useEffect(() => {
    void host.getEndpoint().then(setUrl);
    return host.onState((state, detail) => {
      if (state === 'fatal') setFatal(detail ? { detail } : {});
    });
  }, [host]);

  if (fatal) {
    return (
      <div role="alert" className="flex h-full flex-col">
        <CenteredChrome tone="fatal">
          {fatal.detail ? (
            <>
              The agent process stopped:
              <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-card p-4 text-left font-mono text-[12.5px] leading-relaxed text-muted-foreground">
                {fatal.detail}
              </pre>
            </>
          ) : (
            'The agent process stopped. Personal Usage is unavailable. Restart the app to reconnect.'
          )}
        </CenteredChrome>
      </div>
    );
  }
  // A browser host cannot restart its runtime; its page keeps the disconnected status as before.
  if (lost && host.restartRuntime) {
    return <RuntimeStopped restart={host.restartRuntime} />;
  }
  if (!url) {
    return <CenteredChrome tone="muted">Starting the agent…</CenteredChrome>;
  }
  return <SessionView url={url} host={host} onConnectionLost={onConnectionLost} />;
}
