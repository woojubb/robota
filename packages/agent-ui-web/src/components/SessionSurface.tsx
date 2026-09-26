import { useState } from 'react';

import { AgentActivityPanel } from './AgentActivityPanel.js';
import { Composer } from './Composer.js';
import { ConversationView } from './ConversationView.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { PersonalUsageDashboard } from './PersonalUsageDashboard.js';
import { SessionNotices, SessionTitleBar } from './SessionSurfaceChrome.js';

import type { IWsSessionState } from '../hooks/useSessionClient.js';

/**
 * GUI-005 — the "terminal-noir" desktop session shell (the GUI analog of the TUI's presentation). Pure
 * presentation over an `IWsSessionState`: no hooks, no transport, no session/command/permission logic — it
 * renders the reconstructed session and forwards user intent through the reducer's `send`/`answer*`. The
 * elements mirror the TUI: title bar + status strip, scrollable conversation column, background-activity
 * rail, composer with key hints, and the permission/ask prompt docked above the composer.
 */

/** Designed empty state shown before the first turn. */
function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 px-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-card/40">
          <span className="h-2 w-2 rounded-full bg-primary status-glow" />
        </div>
        <p className="max-w-[280px] font-mono text-xs leading-relaxed text-muted-foreground">
          Session connected. Send a message to start — the agent runs in the sidecar; permissions
          surface here as prompts.
        </p>
      </div>
    </div>
  );
}

/**
 * The full desktop layout over an `IWsSessionState`: title bar · conversation column + composer · activity
 * rail · the pending question docked above the composer. `surface` is an optional label shown next to the mark (e.g. "app").
 */
export function SessionSurface({
  state,
  surface,
  personalUsageEnabled = false,
}: {
  state: IWsSessionState;
  surface?: string;
  /** Desktop shells opt in; embedded/session-only surfaces keep their existing chat-only contract. */
  personalUsageEnabled?: boolean;
}): React.ReactElement {
  const [view, setView] = useState<'chat' | 'usage'>('chat');
  const tasks = state.executionWorkspace?.entries ?? [];
  // The main thread alone is this conversation; the rail earns its width only for work beside it.
  const hasTasks = tasks.some((entry) => entry.kind !== 'main_thread');
  const isEmpty =
    state.messages.length === 0 &&
    !state.streamingText &&
    !state.isThinking &&
    state.activeTools.length === 0;

  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      <SessionTitleBar
        status={state.status}
        surface={surface}
        view={view}
        onView={setView}
        personalUsageEnabled={personalUsageEnabled}
      />

      <SessionNotices state={state} />

      {personalUsageEnabled && view === 'usage' ? (
        <div className="min-h-0 flex-1">
          <PersonalUsageDashboard state={state} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="gui-rise flex min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-hidden">
              {isEmpty ? (
                <EmptyState />
              ) : (
                <ConversationView
                  messages={state.messages}
                  activeTools={state.activeTools}
                  streamingText={state.streamingText}
                  isThinking={state.isThinking}
                />
              )}
            </div>
            <PermissionPrompt
              layout="dock"
              prompts={state.pendingPrompts}
              onAnswerPermission={state.answerPermission}
              onAnswerAsk={state.answerAsk}
            />
            <Composer
              catalog={state.commandCatalog ?? null}
              status={state.sessionStatus ?? null}
              onCommand={(name) => state.send({ type: 'command', name })}
              onSubmit={(prompt) => {
                if (!prompt.startsWith('/')) {
                  state.send({ type: 'submit', prompt });
                  return;
                }
                const [name, ...rest] = prompt.slice(1).trim().split(/\s+/u);
                if (!name) return;
                const args = rest.join(' ');
                state.send({ type: 'command', name, ...(args ? { args } : {}) });
              }}
            />
          </div>

          {hasTasks && (
            <aside className="w-72 flex-shrink-0 overflow-hidden border-l border-border/70 bg-card/15">
              <AgentActivityPanel tasks={tasks} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

/** A centered chrome frame for the pre-session (loading) and fatal states — reused by app shells. */
export function CenteredChrome({
  tone,
  children,
}: {
  tone: 'muted' | 'fatal';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-border/70 bg-card/40 px-4">
        <span
          className={`h-2 w-2 rounded-full ${tone === 'fatal' ? 'bg-rose-500' : 'bg-amber-400 animate-pulse'}`}
        />
        <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground/90">
          robota
        </span>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <div
          className={`max-w-[560px] px-8 text-center font-mono text-xs leading-relaxed ${
            tone === 'fatal' ? 'text-rose-300/80' : 'text-muted-foreground'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
