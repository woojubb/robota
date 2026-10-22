'use client';

import React, { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { createAppViewBridge } from '../app-view/bridge.js';
import { toCallToolResult } from '../app-view/call-tool-result.js';
import { AppViewHostContext, readAppViewHostContext } from '../app-view/host-context.js';
import { appViewKey } from '../hooks/use-app-view-requests.js';

import type { IAppViewHost } from '../app-view/host-context.js';
import type { TAppView } from '../app-view/types.js';
import type { IActiveTool } from '../hooks/useSessionClient.js';

/** The frame starts this tall; the view then asks for the height it needs (bounded by the bridge). */
const INITIAL_HEIGHT_PX = 160;

export const APP_VIEW_UNAVAILABLE_TEXT =
  'This tool returned an app view, which this window cannot show.';

type TLoad =
  | { status: 'loading' }
  | { status: 'ready'; view: TAppView; host: IAppViewHost; sandboxUrl: string; signal: AbortSignal }
  | { status: 'failed'; reason: string };

/**
 * The app a finished tool call's source declared, shown under the call. The document never runs in
 * this page: it is read on demand and handed to the host's sandbox page, which holds it in a frame of
 * its own under the host’s content policy. A surface that
 * supplies no sandbox page shows one plain line instead.
 */
export function AppView({ tool }: { tool: IActiveTool }): React.ReactElement | null {
  const host = useContext(AppViewHostContext);
  if (tool.appView === undefined) return null;
  const viewKey = appViewKey(tool);
  // Nothing is read, from the session or anywhere, unless there is a frame to show it in.
  if (host === null || host.sandboxUrl === undefined || viewKey === undefined) {
    return <p className="text-[13px] text-subtle">{APP_VIEW_UNAVAILABLE_TEXT}</p>;
  }
  return (
    <AppViewFrame
      key={viewKey}
      tool={tool}
      host={host}
      sandboxUrl={host.sandboxUrl}
      viewKey={viewKey}
      sourceId={tool.appView.sourceId}
    />
  );
}

function AppViewFrame({
  tool,
  host,
  sandboxUrl,
  viewKey,
  sourceId,
}: {
  tool: IActiveTool;
  host: IAppViewHost;
  sandboxUrl: string;
  /** Opaque: what `readAppView` and every `callAppTool` of this view are keyed by. */
  viewKey: string;
  sourceId: string;
}): React.ReactElement {
  const [load, setLoad] = useState<TLoad>({ status: 'loading' });
  const [height, setHeight] = useState(INITIAL_HEIGHT_PX);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    host.readAppView(viewKey, controller.signal).then(
      (view) => {
        if (!controller.signal.aborted)
          setLoad({ status: 'ready', view, host, sandboxUrl, signal: controller.signal });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setLoad({
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [viewKey, host.readAppView, host.callAppTool, sandboxUrl]);

  const ready =
    load.status === 'ready' &&
    load.host.readAppView === host.readAppView &&
    load.host.callAppTool === host.callAppTool &&
    load.sandboxUrl === sandboxUrl
      ? load
      : null;
  // A layout effect, so the teardown it posts on unmount still finds the frame in the document.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (ready === null || frame === null) return undefined;
    const current = ready.host;
    const view = ready.view;
    const bridge = createAppViewBridge({
      view,
      toolResult: toCallToolResult(toolRef.current, view),
      hostInfo: current.hostInfo,
      hostContext: readAppViewHostContext(current.platform),
      // The frame's origin is opaque, so no target origin can name it; the bridge accepts replies
      // only from this exact window.
      post: (message) => frame.contentWindow?.postMessage(message, '*'),
      source: () => frame.contentWindow,
      // Every call carries the key this view was read by, so the session can tie it to the view.
      callAppTool: (name, args) => current.callAppTool(viewKey, name, args, ready.signal),
      onHeight: setHeight,
    });
    const onMessage = (event: MessageEvent): void => bridge.handleMessage(event);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      bridge.dispose();
    };
  }, [ready, viewKey]);

  if (load.status === 'failed') {
    return (
      <p className="text-[13px] text-subtle">
        The app from {sourceId} could not be shown: {load.reason}
      </p>
    );
  }
  if (ready === null) {
    return <p className="text-[13px] text-subtle">Loading the app from {sourceId}…</p>;
  }
  return (
    <div className="my-1 flex flex-col gap-1">
      <p className="text-[12px] text-subtle">App from {sourceId}</p>
      <iframe
        ref={frameRef}
        // Exactly one token: scripts may run, and nothing else is granted. Without
        // `allow-same-origin` the frame has an opaque origin, so its document cannot read this page.
        sandbox="allow-scripts"
        src={sandboxUrl}
        title={`App from ${sourceId}`}
        referrerPolicy="no-referrer"
        data-testid="app-view-frame"
        style={{ width: '100%', height }}
        className="block rounded-lg border border-border bg-card"
      />
    </div>
  );
}
