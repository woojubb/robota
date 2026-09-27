import { ArrowUp, Gauge, Shield, Sparkles, Square, Target } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { commandMenuFor } from '../hooks/command-menu.js';

import type { IQueuedPrompt, TCommandCatalog, TSessionStatus } from '../hooks/session-client-types.js';

/** What a caller can do to the composer from outside it — currently just reclaiming focus. */
export interface IComposerHandle {
  /** Focuses the message field — used to send focus back there once a docked prompt is answered. */
  focus: () => void;
}

/**
 * #3280 §4: the unsent draft survives a Chat → Usage → Chat switch (the composer unmounts), a page
 * reload, and a desktop relaunch — `localStorage`, not `sessionStorage`, since only `localStorage`
 * survives a closed window/tab being reopened. Namespaced (`robota.draft.`, matching
 * `robota.restoreSessionId` in `use-session-directory.ts`) so a page hosting other state under the
 * same origin does not collide. Per session id when one is known; a single fallback key before the
 * first status arrives (the gap is brief and is reconciled once it does — see the effect below).
 */
const DRAFT_STORAGE_PREFIX = 'robota.draft.';
const DRAFT_STORAGE_FALLBACK_KEY = 'robota.draft';

function draftStorageKey(sessionId: string | undefined): string {
  return sessionId ? `${DRAFT_STORAGE_PREFIX}${sessionId}` : DRAFT_STORAGE_FALLBACK_KEY;
}

/** Best-effort: a private window, cleared site data, or a full quota still leaves typing working. */
function readDraft(sessionId: string | undefined): string {
  try {
    return window.localStorage.getItem(draftStorageKey(sessionId)) ?? '';
  } catch {
    // allow-fallback: storage unavailable — the draft still lives in component state this session.
    return '';
  }
}

function writeDraft(sessionId: string | undefined, value: string): void {
  try {
    const key = draftStorageKey(sessionId);
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // allow-fallback: same as readDraft — typing (and sending) still work without persistence.
  }
}

/**
 * The composer — the control centre, as desktop agent apps place it: the message box, a `/` menu of
 * the commands and skills the session offers, and a status row (model, permission mode, effort,
 * context). The row's controls run the session's own commands (`/provider`, `/mode`, `/effort`), so a
 * setting changes through the one path every client shares.
 */
export const Composer = forwardRef<
  IComposerHandle,
  {
    onSubmit: (prompt: string) => void;
    onCommand: (name: string) => void;
    catalog: TCommandCatalog | null;
    status: TSessionStatus | null;
    /**
     * False while the transport is not `connected` (issue #3280 §5): Enter and Send refuse to submit,
     * and nothing typed is cleared or lost — the composer never sends into a socket that is not there.
     */
    connected?: boolean;
    /** #3280 §2: a turn (or a blocking command) is running — Send becomes Stop and Esc stops it too. */
    running: boolean;
    onStop: () => void;
    /** #3280 §2: the prompt queued behind the running turn, or null when none is queued. */
    queued: IQueuedPrompt | null;
    onCancelQueue: () => void;
  }
>(function Composer(
  { onSubmit, onCommand, catalog, status, connected = true, running, onStop, queued, onCancelQueue },
  ref,
): React.ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);
  const sessionId = status?.sessionId;
  const sessionIdRef = useRef(sessionId);
  // Whether a REAL session id has ever been seen. A switch goes A -> null -> B — `session_switched`
  // clears `sessionStatus` before `get-status` answers (`useSessionClient.ts`) — so `sessionId` turns
  // transiently `undefined` on an ordinary switch too, not only before the very first status. This
  // ref is the one thing that distinguishes "no session has ever been known yet" (the fallback-key
  // migration case) from "between two known sessions right now" — never overload `undefined` for it.
  const hasKnownSessionRef = useRef(sessionId !== undefined);
  // The draft as last set, read inside effects/handlers without depending on `draft` and risking a
  // stale closure (this ref and the `draft` state are always kept in lockstep by `setDraft` below).
  const draftRef = useRef('');
  const [draft, setDraftState] = useState(() => {
    const initial = readDraft(sessionId);
    draftRef.current = initial;
    return initial;
  });
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const menu = dismissed ? null : commandMenuFor(catalog, draft);
  useEffect(() => {
    setSelected(0);
    setDismissed(false);
  }, [draft]);
  /** #3280 §4: every draft change is persisted at once, so a reload or relaunch loses nothing. */
  const setDraft = (value: string): void => {
    draftRef.current = value;
    setDraftState(value);
    writeDraft(sessionIdRef.current, value);
  };
  // #3280 §4: a session switch shows THAT session's own saved draft, never what was typed for
  // another one. The session id becoming known for the very FIRST time (the fallback key was in use
  // until now) instead carries over what is already typed, rather than discarding it. A transient
  // `undefined` mid-switch, once a real id has already been seen, is not a change at all: stay bound
  // to the last known session — keep showing and writing to ITS draft — until a new CONCRETE id
  // arrives, so keystrokes typed during the round trip never land under the wrong session (or the
  // fallback key).
  useEffect(() => {
    if (sessionId === undefined && hasKnownSessionRef.current) return;
    if (sessionIdRef.current === sessionId) return;
    const firstArrival = !hasKnownSessionRef.current;
    const previous = sessionIdRef.current;
    sessionIdRef.current = sessionId;
    if (sessionId !== undefined) hasKnownSessionRef.current = true;
    const stored = readDraft(sessionId);
    if (firstArrival && !stored && draftRef.current) {
      writeDraft(sessionId, draftRef.current);
      writeDraft(previous, '');
      return;
    }
    draftRef.current = stored;
    setDraftState(stored);
  }, [sessionId]);

  const submit = (): void => {
    if (!connected) return;
    const prompt = draft.trim();
    if (!prompt) return;
    onSubmit(prompt);
    setDraft('');
  };
  /** Complete the highlighted name; a draft that already names it is sent instead. */
  const acceptMenu = (): boolean => {
    const item = menu?.[selected];
    if (!item || draft === `/${item.name}`) return false;
    setDraft(`/${item.name} `);
    return true;
  };
  /** #3280 §2: Edit puts the queued text back in the draft and cancels the queue behind it (the wire
   *  has no per-message cancel — only a whole-queue clear). Offered only when exactly one prompt is
   *  queued: with more than one, `cancel-queue` would still drop every one of them, but only the
   *  shown prompt's text is known here, so "Edit" would silently lose the rest — the row offers only
   *  "Remove all" instead once `queued.count > 1`. */
  const editQueued = (): void => {
    if (!queued) return;
    setDraft(queued.text);
    onCancelQueue();
  };

  return (
    <div className="relative flex-shrink-0">
      {queued && (
        <div
          role="status"
          aria-label="queued prompt"
          className="gui-rise mb-2 flex items-center gap-3 rounded-2xl bg-card px-4 py-2 text-[13px]"
        >
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Queued: {queued.text}
            {queued.count > 1 && (
              <span className="text-subtle"> and {queued.count - 1} more</span>
            )}
          </span>
          {queued.count === 1 ? (
            <>
              <button
                type="button"
                onClick={editQueued}
                className="flex-shrink-0 rounded-lg px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onCancelQueue}
                className="flex-shrink-0 rounded-lg px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
              >
                Remove
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onCancelQueue}
              className="flex-shrink-0 rounded-lg px-2 py-1 text-muted-foreground hover:bg-hover hover:text-foreground"
            >
              Remove all
            </button>
          )}
        </div>
      )}
      {menu && (
        <div
          role="listbox"
          aria-label="commands"
          className="gui-rise absolute bottom-full left-0 right-0 mb-2 max-h-[320px] overflow-y-auto rounded-2xl bg-popover p-1.5 shadow-2xl shadow-black/35"
        >
          {menu.map((item, index) => {
            const runsElsewhere = item.runsIn ? runsInDescription(item.runsIn) : undefined;
            return (
              <button
                key={`${item.kind}:${item.name}`}
                type="button"
                role="option"
                aria-selected={index === selected}
                aria-description={runsElsewhere}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setDraft(`/${item.name} `);
                }}
                className={`flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left text-[14px] ${
                  index === selected ? 'bg-hover' : ''
                }`}
              >
                {/* A command that runs elsewhere dims its name and description by text colour only —
                    an opacity on the row would also fade its badge and the selected highlight. */}
                <span
                  className={`flex-shrink-0 font-mono text-[13.5px] ${runsElsewhere ? 'text-subtle' : 'text-foreground'}`}
                >
                  /{item.name}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${runsElsewhere ? 'text-subtle' : 'text-muted-foreground'}`}
                >
                  {item.description}
                </span>
                {item.kind === 'skill' && <MenuBadge label="skill" />}
                {item.runsIn && (
                  <MenuBadge label={item.runsIn.join(' · ') || 'client'} title={runsElsewhere} />
                )}
              </button>
            );
          })}
        </div>
      )}
      <form
        className="rounded-[22px] bg-card px-2.5 pb-2 pt-2.5 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] transition-shadow focus-within:ring-2 focus-within:ring-ring"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={textareaRef}
          aria-label="message"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // #3280 §4: an Enter that only finishes an IME (Korean/Japanese/Chinese) composition must
            // not submit or accept the menu — `isComposing` (or `keyCode` 229, on browsers that
            // predate it) marks it; the keystroke is left alone so the browser commits the composition
            // normally, matching the guard the free-text prompt field uses (#3280 §3).
            if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) return;
            if (menu) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setSelected((index) => (index + step + menu.length) % menu.length);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDismissed(true);
                return;
              }
              if ((e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) && acceptMenu()) {
                e.preventDefault();
                return;
              }
            }
            // #3280 §2: Esc stops a running turn — but only once the menu (handled above) is out of
            // the way, so dismissing the `/` menu never doubles as an abort. Not while disconnected:
            // an abort could not reach the host either (issue #3280 §5).
            if (e.key === 'Escape' && running && connected) {
              e.preventDefault();
              onStop();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask robota anything — type / for commands"
          className="block max-h-[220px] min-h-[48px] w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-relaxed text-foreground [field-sizing:content] focus:outline-none"
        />
        <div className="mt-1 flex items-center gap-1">
          <StatusRow status={status} onCommand={onCommand} />
          <button
            type={running ? 'button' : 'submit'}
            onClick={running ? onStop : undefined}
            // Stop is unavailable while disconnected too: an abort could not reach the host either.
            disabled={!connected || (!running && !draft.trim())}
            aria-description={connected ? undefined : 'Not connected'}
            className="ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-85 disabled:bg-raised disabled:text-subtle"
          >
            {running ? (
              <Square size={13} strokeWidth={2} fill="currentColor" aria-hidden="true" />
            ) : (
              <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />
            )}
            <span className="sr-only">{running ? 'Stop' : 'Send'}</span>
          </button>
        </div>
      </form>
    </div>
  );
});

/**
 * Where a command the session does not run is run instead. The GUI runs no client command, so its
 * row stays offered — choosing it inserts the command and the session answers with its refusal —
 * but says where it works.
 */
function runsInDescription(runsIn: readonly string[]): string {
  return `Runs in the robota ${runsIn.join(' or ') || 'client'}`;
}

/** Solid muted text, never an opacity, so a small badge stays legible on a plain or selected row. */
function MenuBadge({ label, title }: { label: string; title?: string }): React.ReactElement {
  return (
    <span
      title={title}
      className="flex-shrink-0 rounded-md bg-raised px-1.5 py-px text-[12px] text-muted-foreground"
    >
      {label}
    </span>
  );
}

/**
 * The goal being pursued (`/goal`), above the composer while it is active — the objective, how far
 * the turn budget has gone, and a way to stop it (`/goal cancel`).
 */
export function GoalBar({
  status,
  onStop,
}: {
  status: TSessionStatus | null;
  onStop: () => void;
}): React.ReactElement | null {
  const goal = status?.goal;
  if (!goal || goal.status !== 'active') return null;
  const progress = goal.maxIterations > 0 ? Math.min(1, goal.iterations / goal.maxIterations) : 0;
  return (
    <div
      role="status"
      aria-label="goal"
      className="gui-rise relative flex flex-shrink-0 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 py-2.5 text-[14px]"
    >
      <Target size={16} strokeWidth={1.75} className="flex-shrink-0 text-accent" />
      <span className="flex-shrink-0 font-medium text-foreground">Goal</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{goal.objective}</span>
      <span className="flex-shrink-0 text-[13px] tabular-nums text-subtle">
        {goal.iterations}/{goal.maxIterations}
      </span>
      <button
        type="button"
        aria-label="Stop goal"
        onClick={onStop}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Square size={11} fill="currentColor" aria-hidden="true" />
        Stop
      </button>
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-[2px] bg-accent/70 transition-[width]"
        style={{ width: `${progress * 100}%` }}
      />
    </div>
  );
}

/** Model · mode · effort, each opening its picker, and the context the conversation fills. */
function StatusRow({
  status,
  onCommand,
}: {
  status: TSessionStatus | null;
  onCommand: (name: string) => void;
}): React.ReactElement {
  const chip = (
    label: string,
    value: string,
    command: string,
    icon: React.ReactElement,
  ): React.ReactElement => (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      title={`Change ${label}`}
      onClick={() => onCommand(command)}
      className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
    >
      {icon}
      <span className="truncate">{value}</span>
    </button>
  );
  const used = status ? Math.round(status.context.usedPercentage) : null;
  const iconProps = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      {status ? (
        <>
          {chip('mode', status.permissionMode, 'mode', <Shield {...iconProps} />)}
          <span className="ml-auto" />
          {chip('model', status.model, 'provider', <Sparkles {...iconProps} />)}
          {chip('effort', status.effort, 'effort', <Gauge {...iconProps} />)}
        </>
      ) : (
        <span className="ml-auto px-2 text-[13px] text-subtle">…</span>
      )}
      <span
        className="flex items-center gap-1.5 px-1.5 text-[12.5px] tabular-nums text-subtle"
        title="Context used"
        aria-label={`context ${used ?? 0}% used`}
      >
        <ContextRing percent={used ?? 0} />
        {used === null ? '' : `${used}%`}
      </span>
    </div>
  );
}

function ContextRing({ percent }: { percent: number }): React.ReactElement {
  const r = 5;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(100, Math.max(0, percent)) / 100;
  const tone = percent >= 80 ? 'stroke-warning' : 'stroke-muted-foreground';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r={r} className="fill-none stroke-raised" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r={r}
        className={`fill-none ${tone}`}
        strokeWidth="2"
        strokeDasharray={`${circumference * filled} ${circumference}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}
