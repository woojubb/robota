import { useState } from 'react';

import { AgentActivityPanel } from './AgentActivityPanel.js';
import { ConversationView } from './ConversationView.js';
import { PermissionPrompt } from './PermissionPrompt.js';

import type { IWsSessionState } from '../hooks/useSessionClient.js';

/**
 * GUI-005 — the "terminal-noir" desktop session shell (the GUI analog of the TUI's presentation). Pure
 * presentation over an `IWsSessionState`: no hooks, no transport, no session/command/permission logic — it
 * renders the reconstructed session and forwards user intent through the reducer's `send`/`answer*`. The
 * elements mirror the TUI: title bar + status strip, scrollable conversation column, background-activity
 * rail, composer with key hints, and the permission/ask modal.
 */

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-primary status-glow',
  connecting: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-zinc-600',
  error: 'bg-rose-500',
};

/** Title bar: robota mark, live connection status (raw status text kept for tests), optional surface label. */
function TitleBar({ status, surface }: { status: string; surface?: string }): React.ReactElement {
  const dot = STATUS_DOT[status] ?? STATUS_DOT.disconnected;
  return (
    <header
      className="agent-gui-status flex h-11 flex-shrink-0 items-center gap-3 border-b border-border/70 bg-card/40 px-4 backdrop-blur-sm"
      data-status={status}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary status-glow" />
        <span className="font-mono text-[13px] font-semibold tracking-[0.22em] text-foreground/90">
          robota
        </span>
        {surface ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
            {surface}
          </span>
        ) : null}
      </div>
      <span className="text-border/70">/</span>
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="font-mono text-[11px] text-muted-foreground">{status}</span>
      </div>
      <div className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/50">
        <span className="rounded border border-border/60 px-1.5 py-0.5">local · owner</span>
      </div>
    </header>
  );
}

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

/** The composer: multiline textarea (Enter sends, ⇧Enter newline) + Send, with a key-hint strip. */
function Composer({ onSubmit }: { onSubmit: (prompt: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    const prompt = draft.trim();
    if (!prompt) return;
    onSubmit(prompt);
    setDraft('');
  };
  return (
    <div className="flex-shrink-0 border-t border-border/70 bg-card/25 px-3 pb-2 pt-2.5">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="message"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message the agent…"
          className="max-h-[140px] min-h-[38px] flex-1 resize-none rounded-xl border border-border/70 bg-background/60 px-3.5 py-2.5 text-sm leading-relaxed text-foreground transition-all placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="h-[38px] rounded-xl border border-border/70 px-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send
        </button>
      </form>
      <div className="mt-1.5 px-1 font-mono text-[10px] tracking-wide text-muted-foreground/45">
        <span className="text-muted-foreground/70">Enter</span> send
        <span className="mx-1.5 text-border">·</span>
        <span className="text-muted-foreground/70">⇧ Enter</span> newline
      </div>
    </div>
  );
}

/**
 * The full desktop layout over an `IWsSessionState`: title bar · conversation column + composer · activity
 * rail · permission modal. `surface` is an optional label shown next to the mark (e.g. "app").
 */
export function SessionSurface({
  state,
  surface,
}: {
  state: IWsSessionState;
  surface?: string;
}): React.ReactElement {
  const tasks = state.executionWorkspace?.entries ?? [];
  const hasTasks = tasks.length > 0;
  const isEmpty =
    state.messages.length === 0 &&
    !state.streamingText &&
    !state.isThinking &&
    state.activeTools.length === 0;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar status={state.status} surface={surface} />

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
          <Composer onSubmit={(prompt) => state.send({ type: 'submit', prompt })} />
        </div>

        {hasTasks && (
          <aside className="w-72 flex-shrink-0 overflow-hidden border-l border-border/70 bg-card/15">
            <AgentActivityPanel tasks={tasks} />
          </aside>
        )}
      </div>

      <PermissionPrompt
        prompts={state.pendingPrompts}
        onAnswerPermission={state.answerPermission}
        onAnswerAsk={state.answerAsk}
      />
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
        <p
          className={`max-w-[300px] px-8 text-center font-mono text-xs leading-relaxed ${
            tone === 'fatal' ? 'text-rose-300/80' : 'text-muted-foreground'
          }`}
        >
          {children}
        </p>
      </div>
    </div>
  );
}
