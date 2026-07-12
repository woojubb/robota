import {
  ConversationView,
  AgentActivityPanel,
  PermissionPrompt,
  useWsSession,
  type IWsSessionState,
} from '@robota-sdk/agent-web-ui/client';
import { useEffect, useState } from 'react';

import type { TSidecarState } from '../electron/sidecar.js';

/**
 * GUI-002 renderer compose-root. Mirrors the TUI/`RemoteClient` pattern: it drives the transport-neutral
 * session ONLY through `agent-web-ui`'s reducer + components — no session/command/permission logic here. The
 * loopback endpoint (with the auth token) comes from the Electron preload bridge; the sidecar owns everything
 * below the wire.
 */

/**
 * Pure presentation over an `IWsSessionState` (no hooks, no transport) — unit-testable with a stub state
 * (TC-01/TC-02). Renders the conversation, the background-activity panel, the permission/ask prompts, and a
 * composer that submits a turn via the reducer's `send`.
 */
export function SessionSurface({ state }: { state: IWsSessionState }): React.ReactElement {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    const prompt = draft.trim();
    if (!prompt) return;
    state.send({ type: 'submit', prompt });
    setDraft('');
  };

  return (
    <div className="agent-gui-root">
      <header className="agent-gui-status" data-status={state.status}>
        {state.status}
      </header>

      <ConversationView
        messages={state.messages}
        activeTools={state.activeTools}
        streamingText={state.streamingText}
        isThinking={state.isThinking}
      />

      {state.executionWorkspace ? (
        <AgentActivityPanel tasks={state.executionWorkspace.entries} />
      ) : null}

      <PermissionPrompt
        prompts={state.pendingPrompts}
        onAnswerPermission={state.answerPermission}
        onAnswerAsk={state.answerAsk}
      />

      <form
        className="agent-gui-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          aria-label="message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the agent…"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

/** Thin wire binding: connect to the loopback sidecar over WS and render the surface. */
function SessionView({ url }: { url: string }): React.ReactElement {
  const state = useWsSession(url);
  useEffect(() => {
    if (state.status === 'connected') window.agentGui.signalReady();
  }, [state.status]);
  return <SessionSurface state={state} />;
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
      <div className="agent-gui-fatal" role="alert">
        The agent process stopped. Restart the app to reconnect.
      </div>
    );
  }
  if (!url) {
    return <div className="agent-gui-loading">Starting the agent…</div>;
  }
  return <SessionView url={url} />;
}
