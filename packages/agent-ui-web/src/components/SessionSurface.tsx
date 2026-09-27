import { useRef, useState } from 'react';

import { AgentActivityPanel } from './AgentActivityPanel.js';
import { RobotaMark, RobotaWordmark } from './Brand.js';
import { Composer, GoalBar } from './Composer.js';
import { ConversationView } from './ConversationView.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { PersonalUsageDashboard } from './PersonalUsageDashboard.js';
import { SessionSidebar, SessionSidebarRail, sessionTitle } from './SessionSidebar.js';
import { ConnectionBanner, SessionNotices, SessionTitleBar } from './SessionSurfaceChrome.js';

import type { IComposerHandle } from './Composer.js';
import type { IWsSessionState } from '../hooks/useSessionClient.js';

/**
 * The desktop session shell — the GUI analog of the TUI's presentation. Pure presentation over an
 * `IWsSessionState`: no hooks, no transport, no session/command/permission logic — it renders the
 * reconstructed session and forwards user intent through the reducer's `send`/`answer*`. The session
 * sidebar runs the full height on the left once the host has listed its sessions (a host that cannot
 * has none); beside it the title bar, the conversation, the pending question docked above the
 * composer, and the background-activity rail on the right when work runs beside the conversation.
 */

/** The column every part of the conversation shares, so messages, prompt and composer line up. */
const COLUMN = 'mx-auto w-full max-w-[760px] px-6';

/**
 * Designed empty state shown before the first turn. Renders in the same slot as `ConversationView`
 * (never together), so it carries the same `main` landmark and label (#3289 §3 review) — nothing
 * above this slot supplies one.
 */
function EmptyState(): React.ReactElement {
  return (
    <main className="flex h-full items-center justify-center" aria-label="Conversation">
      <div className="gui-rise flex max-w-[440px] flex-col items-center gap-4 px-8 text-center">
        <RobotaMark size={40} />
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">
          What are we working on?
        </h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Session connected. Send a message to start — the agent works in the robota runtime and
          asks you here before anything that needs your permission.
        </p>
      </div>
    </main>
  );
}

/**
 * Issue #3282 §3 — shown in place of the conversation while `sessionStatus.setupRequired` holds: the
 * session is running (the GUI itself connected fine), but has no provider to reply with yet. "Set up
 * provider" runs `/provider add` as a command; its questions dock above where the composer would be
 * (the same `PermissionPrompt` any ask uses), and the panel clears itself once the session reports a
 * real provider, live — no restart, no reload.
 *
 * Renders in the same slot as `ConversationView`/`EmptyState` (never together), so it carries the
 * page's `main` landmark here too (#3289 §3 review) — nothing above this slot supplies one.
 */
function SetupPanel({
  onSetUp,
  disabled,
}: {
  onSetUp: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <main className="flex h-full items-center justify-center" aria-label="Set up a provider">
      <div className="gui-rise flex max-w-[440px] flex-col items-center gap-4 px-8 text-center">
        <RobotaMark size={40} />
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">
          Connect a model provider to start.
        </h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Robota needs a provider profile — a type, a key and a model — before it can reply. Set one
          up now; you can add more or change it later the same way.
        </p>
        <button
          type="button"
          onClick={onSetUp}
          disabled={disabled}
          className="rounded-lg bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          Set up provider
        </button>
      </div>
    </main>
  );
}

/**
 * The full desktop layout over an `IWsSessionState`. `surface` is an optional label shown next to the
 * mark (e.g. "app").
 */
export function SessionSurface({
  state,
  surface,
  personalUsageEnabled = false,
  onReconnect,
}: {
  state: IWsSessionState;
  surface?: string;
  /** Desktop shells opt in; embedded/session-only surfaces keep their existing chat-only contract. */
  personalUsageEnabled?: boolean;
  /**
   * Present only when the host can restart the runtime after the connection is lost for good (issue
   * #3280 §5, the desktop app); absent in the browser, where the banner says how to reopen it instead.
   */
  onReconnect?: () => Promise<void>;
}): React.ReactElement {
  const [view, setView] = useState<'chat' | 'usage'>('chat');
  const composerRef = useRef<IComposerHandle>(null);
  const tasks = state.executionWorkspace?.entries ?? [];
  // The main thread alone is this conversation; the rail earns its width only for work beside it.
  const hasTasks = tasks.some((entry) => entry.kind !== 'main_thread');
  const isEmpty =
    state.messages.length === 0 &&
    !state.streamingText &&
    !state.isThinking &&
    state.activeTools.length === 0;
  // #3282 §3: no provider is configured — the session is running (a placeholder stands in for the
  // real one), but there is nothing to reply with yet.
  const setupRequired = state.sessionStatus?.setupRequired === true;
  const hasSessionList =
    (state.sessionListing ?? null) !== null || state.sessionsError?.code === 'list_failed';
  const sidebarOpen = hasSessionList && state.sessionSidebarOpen;
  const usage = personalUsageEnabled && view === 'usage';
  const listing = state.sessionListing ?? null;
  const currentRow = listing?.sessions.find((session) => session.id === listing.currentSessionId);
  // A rename seen on this page wins; otherwise the host's listing names the current session.
  const title = state.sessionName ?? (currentRow ? sessionTitle(currentRow) : null);
  // Choosing a session from the sidebar shows its conversation, whichever view was open.
  const sidebarState: IWsSessionState = {
    ...state,
    switchSession: (sessionId) => {
      setView('chat');
      state.switchSession?.(sessionId);
    },
    newSession: () => {
      setView('chat');
      state.newSession?.();
    },
  };

  return (
    <div className="robota-ui relative flex h-full bg-background text-foreground">
      {hasSessionList ? (
        sidebarOpen ? (
          // Narrow windows lay it over the conversation instead of squeezing it.
          <SessionSidebar
            state={sidebarState}
            brand={<RobotaWordmark surface={surface} />}
            className="absolute inset-y-0 left-0 z-30 shadow-2xl shadow-black/40 md:static md:z-auto md:shadow-none"
          />
        ) : (
          <SessionSidebarRail state={sidebarState} />
        )
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <SessionTitleBar
          status={state.status}
          surface={surface}
          title={title}
          showBrand={!sidebarOpen}
          view={view}
          onView={setView}
          personalUsageEnabled={personalUsageEnabled}
        />

        {usage ? (
          <div className="min-h-0 flex-1">
            <PersonalUsageDashboard state={state} />
            {/* A gated turn waits on this answer, so it shows over whatever view is open. */}
            <PermissionPrompt
              layout="modal"
              prompts={state.pendingPrompts}
              onAnswerPermission={state.answerPermission}
              onAnswerAsk={state.answerAsk}
              ownDriverId={state.ownDriverId}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <ConnectionBanner
                status={state.status}
                connectionLost={state.connectionLost ?? false}
                onReconnect={onReconnect}
              />
              <div className="min-h-0 flex-1 overflow-hidden">
                {setupRequired ? (
                  <SetupPanel
                    onSetUp={() => state.send({ type: 'command', name: 'provider', args: 'add' })}
                    disabled={state.status !== 'connected'}
                  />
                ) : isEmpty ? (
                  <EmptyState />
                ) : (
                  <ConversationView
                    messages={state.messages}
                    activeTools={state.activeTools}
                    streamingText={state.streamingText}
                    isThinking={state.isThinking}
                    ownDriverId={state.ownDriverId}
                  />
                )}
              </div>
              <div
                className={`${COLUMN} relative flex flex-shrink-0 flex-col gap-2 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-background before:to-transparent`}
              >
                <GoalBar
                  status={state.sessionStatus ?? null}
                  onStop={() => state.send({ type: 'command', name: 'goal', args: 'cancel' })}
                />
                <PermissionPrompt
                  layout="dock"
                  prompts={state.pendingPrompts}
                  onAnswerPermission={state.answerPermission}
                  onAnswerAsk={state.answerAsk}
                  ownDriverId={state.ownDriverId}
                  onFocusReturn={() => composerRef.current?.focus()}
                />
                {/* #3282 §3: hidden while there is no provider to send to — the setup panel's own
                    button is the only way in, so nobody types into a composer that goes nowhere. */}
                {setupRequired ? null : (
                  <Composer
                    ref={composerRef}
                    catalog={state.commandCatalog ?? null}
                    status={state.sessionStatus ?? null}
                    connected={state.status === 'connected'}
                    running={state.isThinking}
                    onStop={() => state.send({ type: 'abort' })}
                    queued={state.queuedPrompt}
                    onCancelQueue={() => {
                      state.send({ type: 'cancel-queue' });
                      // No push confirms a cleared queue (unlike a resolved prompt); ask, so the row
                      // reliably disappears instead of trusting the clear went through.
                      state.send({ type: 'get-pending' });
                    }}
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
                )}
              </div>
            </div>

            {hasTasks && (
              <aside className="flex w-72 flex-shrink-0 overflow-hidden bg-sidebar">
                <AgentActivityPanel tasks={tasks} className="flex-1" />
              </aside>
            )}
          </div>
        )}
      </div>

      <SessionNotices state={state} />
    </div>
  );
}

/**
 * A centered chrome frame for the pre-session (loading) and fatal states — reused by app shells. Its
 * content area is this page's `main` landmark (#3289 §3 review): nothing above `CenteredChrome`'s
 * three call sites (starting, fatal, the trust question) supplies one, and none of the three ever
 * render alongside `SessionSurface`'s own. `header` stays a sibling of `main`, not inside it, so it
 * keeps its own implicit `banner` role.
 */
export function CenteredChrome({
  tone,
  children,
}: {
  tone: 'muted' | 'fatal';
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="robota-ui flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 flex-shrink-0 items-center px-5">
        <RobotaWordmark />
      </header>
      <main className="flex flex-1 items-center justify-center">
        <div className="gui-rise flex max-w-[520px] flex-col items-center gap-4 px-8 text-center">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              tone === 'fatal' ? 'bg-destructive' : 'animate-pulse bg-warning'
            }`}
          />
          <div
            className={`text-[15px] leading-relaxed ${
              tone === 'fatal' ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
