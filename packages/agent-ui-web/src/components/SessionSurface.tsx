import { useEffect, useRef, useState } from 'react';

import { AgentActivityPanel } from './AgentActivityPanel.js';
import { AgentSwitcherSheet } from './AgentSwitcherSheet.js';
import { ProductMark, ProductWordmark } from './Brand.js';
import { Composer, GoalBar } from './Composer.js';
import { ConversationView } from './ConversationView.js';
import { Dialog } from './Dialog.js';
import { ExecutionDetailSheet } from './ExecutionDetailSheet.js';
import { HelpSheet } from './HelpSheet.js';
import { PermissionPrompt } from './PermissionPrompt.js';
import { PersonalUsageDashboard } from './PersonalUsageDashboard.js';
import { ProjectPanel } from './ProjectPanel.js';
import { SessionSidebar, SessionSidebarRail, sessionTitle } from './SessionSidebar.js';
import { ConnectionBanner, SessionNotices, SessionTitleBar } from './SessionSurfaceChrome.js';
import { SettingsScreen } from './SettingsScreen.js';
import { NARROW_WINDOW_QUERY, useMediaQuery } from '../hooks/use-media-query.js';

import type { IComposerHandle, IPickedFile } from './Composer.js';
import type { TSessionView } from './SessionSurfaceChrome.js';
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
        <ProductMark size={40} />
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">
          What are we working on?
        </h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Session connected. Send a message to start — the agent works in the host runtime and
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
        <ProductMark size={40} />
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">
          Connect a model provider to start.
        </h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          Choose a provider and model to start. Enter a key if your provider requires one. You can
          add more providers or change them later the same way.
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
  pickFiles,
  getPathForFile,
  onOpenMemoryInEditor,
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
  /** Forwarded to the composer's attach button — present only on the desktop app (#3282 §4d). */
  pickFiles?: () => Promise<readonly IPickedFile[]>;
  /** Forwarded to the composer's drag-and-drop — present only on the desktop app (#3282 §4d). */
  getPathForFile?: (file: File) => string;
  /**
   * The Project panel's memory "Open in editor" action — present only when the host can open a file
   * in an external editor (the desktop app, #3282 §4c). Absent in the browser, where the action
   * itself is hidden (only shown "if the host supports it").
   */
  onOpenMemoryInEditor?: (path: string) => void;
}): React.ReactElement {
  const [view, setView] = useState<TSessionView>('chat');
  const composerRef = useRef<IComposerHandle>(null);
  const tasks = state.executionWorkspace?.entries ?? [];
  // The main thread alone is this conversation; the rail earns its width only for work beside it.
  const hasTasks = tasks.some((entry) => entry.kind !== 'main_thread');
  // #3288 §1: the entry open in the detail sheet, resolved fresh from the live snapshot each render
  // (so it reflects the entry's own updates, e.g. a Stop taking effect) rather than a stale copy.
  const openEntry = tasks.find((entry) => entry.id === state.openEntryId) ?? null;
  // A loop's `cancel` means "stop the loop" (`/loop stop <id>`) — never cancel-background-task,
  // which for a self-paced loop would only cancel its disposable wake timer, leaving the loop
  // itself active (see IExecutionWorkspaceEntry.loopId).
  const stopExecutionEntry = (entry: { loopId?: string; sourceId: string }): void => {
    if (entry.loopId !== undefined) {
      state.send({ type: 'command', name: 'loop', args: `stop ${entry.loopId}` });
    } else {
      state.send({ type: 'cancel-background-task', taskId: entry.sourceId });
    }
  };
  // #3282 §4 part b-3: the rail also earns its width for a schedule or a goal, even with no running
  // background task/loop beside the conversation — "Work in progress" covers all four (issue #3282
  // §4's Expected section), not only execution-workspace entries.
  const currentGoal = state.sessionStatus?.goal ?? null;
  const hasWorkInProgress = hasTasks || state.scheduledTasks.length > 0 || currentGoal !== null;
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
  const project = view === 'project';
  const listing = state.sessionListing ?? null;
  const currentRow = listing?.sessions.find((session) => session.id === listing.currentSessionId);
  // A rename seen on this page wins; otherwise the host's listing names the current session.
  const title = state.sessionName ?? (currentRow ? sessionTitle(currentRow) : null);
  // #3289 §2 — below `md` the open sidebar is a sheet over the conversation (the shared `Dialog`,
  // #3331) rather than a column beside it: a dimmed backdrop, Esc, an outside click or choosing a
  // session all close it again, and it traps Tab inside it while open.
  const isNarrow = useMediaQuery(NARROW_WINDOW_QUERY);
  const sheetActive = sidebarOpen && isNarrow;
  const closeSidebar = (): void => state.setSessionSidebarOpen?.(false);
  // The sheet's own opener — the rail's "Show sessions" button — unmounts in the SAME update that
  // mounts the sheet (the ternary below swaps `SessionSidebarRail` for `Dialog`), so passing it as
  // `Dialog`'s `restoreFocusTo` would only hand back a node already detached from the document by the
  // time `Dialog` reads it — a `.focus()` on that node is a harmless no-op, not a restore. This effect
  // does the real work instead: a `focusin` listener captures the opener the moment it actually had
  // focus, while the sheet is closed; on close, a control that reappeared under the same `aria-label`
  // (the rail's button, remounted) is as good a return address as the original node.
  const sheetOpenerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (sheetActive) return undefined;
    const onFocusIn = (event: FocusEvent): void => {
      if (event.target instanceof HTMLElement) sheetOpenerRef.current = event.target;
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [sheetActive]);
  const wasSheetActiveRef = useRef(false);
  useEffect(() => {
    if (wasSheetActiveRef.current && !sheetActive) {
      const opener = sheetOpenerRef.current;
      const label = opener?.getAttribute('aria-label');
      const target =
        opener && document.contains(opener)
          ? opener
          : label
            ? document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
            : null;
      target?.focus();
    }
    wasSheetActiveRef.current = sheetActive;
  }, [sheetActive]);
  // Choosing a session from the sidebar shows its conversation, whichever view was open — and, while
  // it is a narrow-window sheet, closes it too, exactly as a backdrop click or Esc would.
  const sidebarState: IWsSessionState = {
    ...state,
    switchSession: (sessionId) => {
      setView('chat');
      state.switchSession?.(sessionId);
      if (sheetActive) closeSidebar();
    },
    newSession: () => {
      setView('chat');
      state.newSession?.();
      if (sheetActive) closeSidebar();
    },
  };
  const sidebarPanel = (
    <SessionSidebar
      state={sidebarState}
      brand={<ProductWordmark surface={surface} />}
      className={
        sheetActive
          ? 'h-full'
          : 'absolute inset-y-0 left-0 z-30 shadow-2xl shadow-black/40 md:static md:z-auto md:shadow-none'
      }
    />
  );

  return (
    <div className="agent-ui relative flex h-full bg-background text-foreground">
      {hasSessionList ? (
        sidebarOpen ? (
          isNarrow ? (
            <Dialog
              open={sheetActive}
              onClose={closeSidebar}
              title="Sessions"
              panelClassName="mr-auto flex h-full w-[272px] max-w-[85vw] flex-col self-stretch overflow-hidden rounded-2xl bg-sidebar shadow-2xl shadow-black/40 focus:outline-none"
            >
              {sidebarPanel}
            </Dialog>
          ) : (
            // Wide windows keep it as a static column beside the conversation.
            sidebarPanel
          )
        ) : (
          <SessionSidebarRail state={sidebarState} />
        )
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <SessionTitleBar
          status={state.status}
          surface={surface}
          title={title}
          workspace={state.sessionStatus?.workspace}
          showBrand={!sidebarOpen}
          view={view}
          onView={setView}
          personalUsageEnabled={personalUsageEnabled}
          connectionLost={state.connectionLost ?? false}
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
        ) : project ? (
          <div className="min-h-0 flex-1">
            <ProjectPanel state={state} onOpenMemoryInEditor={onOpenMemoryInEditor} />
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
                    pickFiles={pickFiles}
                    getPathForFile={getPathForFile}
                    onCancelQueue={() => {
                      state.send({ type: 'cancel-queue' });
                      // No push confirms a cleared queue (unlike a resolved prompt); ask, so the row
                      // reliably disappears instead of trusting the clear went through.
                      state.send({ type: 'get-pending' });
                    }}
                    onCommand={(name, args) =>
                      state.send({ type: 'command', name, ...(args ? { args } : {}) })
                    }
                    modelList={state.modelList}
                    onRequestModelList={() => state.requestModelList()}
                    onSilentCommand={(name, args) => state.sendCommandSilently(name, args)}
                    // #3282 §4b: "Manage providers…" now opens Settings at the Providers & Models
                    // section, replacing the model menu's former server-driven profile flow.
                    onManageProviders={() => state.openSettings('providers')}
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

            {hasWorkInProgress && (
              <aside aria-label="Agents" className="flex w-72 flex-shrink-0 overflow-hidden bg-sidebar">
                <AgentActivityPanel
                  tasks={tasks}
                  className="flex-1"
                  selectedEntryId={state.openEntryId ?? undefined}
                  onSelect={(entry) => state.openExecutionDetail(entry.id)}
                  onReturnToConversation={() => state.closeExecutionDetail()}
                  onStop={stopExecutionEntry}
                  schedules={state.scheduledTasks}
                  goal={currentGoal}
                  onPauseSchedule={state.pauseSchedule}
                  onResumeSchedule={state.resumeSchedule}
                  onDeleteSchedule={state.deleteSchedule}
                  onCancelGoal={() => state.send({ type: 'command', name: 'goal', args: 'cancel' })}
                />
              </aside>
            )}

            <ExecutionDetailSheet
              entry={openEntry}
              status={state.executionDetailStatus}
              records={state.executionDetailRecords}
              error={state.executionDetailError}
              complete={state.executionDetailComplete}
              onClose={() => state.closeExecutionDetail()}
              onLoadMore={() => state.loadMoreExecutionDetail()}
              onStop={openEntry ? () => stopExecutionEntry(openEntry) : undefined}
            />
          </div>
        )}
      </div>

      <SessionNotices state={state} />
      <SettingsScreen state={state} />
      <AgentSwitcherSheet state={state} />
      <HelpSheet open={state.helpOpen} onClose={() => state.closeHelp()} catalog={state.commandCatalog} />
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
    <div className="agent-ui flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 flex-shrink-0 items-center px-5">
        <ProductWordmark />
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
