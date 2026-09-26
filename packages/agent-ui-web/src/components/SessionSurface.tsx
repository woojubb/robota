import { useState } from 'react';

import { AgentActivityPanel } from './AgentActivityPanel.js';
import { RobotaMark, RobotaWordmark } from './Brand.js';
import { Composer, GoalBar } from './Composer.js';
import { ConversationView } from './ConversationView.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { PersonalUsageDashboard } from './PersonalUsageDashboard.js';
import { SessionSidebar, SessionSidebarRail } from './SessionSidebar.js';
import { SessionNotices, SessionTitleBar } from './SessionSurfaceChrome.js';

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

/** Designed empty state shown before the first turn. */
function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
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
    </div>
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
  const hasSessionList =
    (state.sessionListing ?? null) !== null || state.sessionsError?.code === 'list_failed';
  const sidebarOpen = hasSessionList && state.sessionSidebarOpen;
  const usage = personalUsageEnabled && view === 'usage';

  return (
    <div className="relative flex h-full bg-background text-foreground">
      {hasSessionList ? (
        sidebarOpen ? (
          // Narrow windows lay it over the conversation instead of squeezing it.
          <SessionSidebar
            state={state}
            brand={<RobotaWordmark surface={surface} />}
            className="absolute inset-y-0 left-0 z-30 shadow-2xl shadow-black/40 md:static md:z-auto md:shadow-none"
          />
        ) : (
          <SessionSidebarRail state={state} />
        )
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <SessionTitleBar
          status={state.status}
          surface={surface}
          title={state.sessionName}
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
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
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
      <header className="flex h-12 flex-shrink-0 items-center px-5">
        <RobotaWordmark />
      </header>
      <div className="flex flex-1 items-center justify-center">
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
      </div>
    </div>
  );
}
