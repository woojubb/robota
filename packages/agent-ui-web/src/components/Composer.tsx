import { ArrowUp, Paperclip, Square, Target, X } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { commandMenuFor } from '../hooks/command-menu.js';
import type { ICommandMenuItem } from '../hooks/command-menu.js';
import {
  buildPromptWithAttachments,
  evaluateCandidateFile,
  type ICandidateFile,
  type IDraftAttachment,
  type IPickedFile,
} from './composer-attachments.js';
import { StatusRow } from './StatusControls.js';

import type {
  IQueuedPrompt,
  TCommandCatalog,
  TModelListSnapshot,
  TSessionStatus,
} from '../hooks/session-client-types.js';

export type { IPickedFile } from './composer-attachments.js';

/** What a caller can do to the composer from outside it — currently just reclaiming focus. */
export interface IComposerHandle {
  /** Focuses the message field — used to send focus back there once a docked prompt is answered. */
  focus: () => void;
}

/** The draft as persisted: the typed text plus any attachment chips (#3282 §4d). */
interface IStoredDraft {
  readonly text: string;
  readonly attachments: readonly IDraftAttachment[];
}

const EMPTY_DRAFT: IStoredDraft = { text: '', attachments: [] };

/**
 * #3282 §4e: a command whose whole job is opening a GUI screen — choosing it from the `/` menu runs
 * it at once (its `ui_intent` opens the screen the normal way) instead of filling the draft and
 * waiting for Enter, since there is nothing useful to type after it. `help` never reaches the
 * session at all (`useSessionClient.ts`'s `send` opens the Help sheet locally). Every other command
 * still "runs as today": chosen or Tab-completed, it fills the draft for its arguments.
 */
const IMMEDIATE_SCREEN_COMMANDS: ReadonlySet<string> = new Set(['settings', 'resume', 'help']);

function isImmediateScreenCommand(item: ICommandMenuItem): boolean {
  return item.kind === 'command' && IMMEDIATE_SCREEN_COMMANDS.has(item.name);
}

/** The group a menu row falls under — shown as a header above the first row of each. */
function menuGroupLabel(item: ICommandMenuItem): 'Commands' | 'Skills' {
  return item.kind === 'skill' ? 'Skills' : 'Commands';
}

/**
 * #3280 §4: the unsent draft survives a Chat → Usage → Chat switch (the composer unmounts), a page
 * reload, and a desktop relaunch — `localStorage`, not `sessionStorage`, since only `localStorage`
 * survives a closed window/tab being reopened. Namespaced (`robota.draft.`, matching
 * `robota.restoreSessionId` in `use-session-directory.ts`) so a page hosting other state under the
 * same origin does not collide. Per session id when one is known; a single fallback key before the
 * first status arrives (the gap is brief and is reconciled once it does — see the effect below).
 *
 * #3282 §4d: the stored value is now JSON (`IStoredDraft`), not the bare text string it used to be —
 * `parseStoredDraft` treats anything that does not parse as that shape (including a draft saved
 * before this change shipped) as plain text with no attachments, so an old stored draft still loads.
 */
const DRAFT_STORAGE_PREFIX = 'robota.draft.';
const DRAFT_STORAGE_FALLBACK_KEY = 'robota.draft';

function draftStorageKey(sessionId: string | undefined): string {
  return sessionId ? `${DRAFT_STORAGE_PREFIX}${sessionId}` : DRAFT_STORAGE_FALLBACK_KEY;
}

/**
 * A stored attachment's shape is never trusted blindly: it is `localStorage`, not this component's
 * own state, so it can be edited by hand, left over from a future version with a different shape, or
 * just corrupted. A missing/non-string `name` or `relativePath` would otherwise show a blank chip and
 * send a broken (or empty) `@`-reference on submit — dropped instead of risking either.
 */
function isStoredAttachment(value: unknown): value is IDraftAttachment {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.relativePath === 'string' &&
    typeof candidate.size === 'number'
  );
}

function parseStoredDraft(raw: string | null): IStoredDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
      const attachments = (parsed as { attachments?: unknown }).attachments;
      return {
        text: (parsed as { text: string }).text,
        attachments: Array.isArray(attachments) ? attachments.filter(isStoredAttachment) : [],
      };
    }
  } catch {
    // Not JSON — a draft saved before attachments shipped. Fall through to plain text below.
  }
  return { text: raw, attachments: [] };
}

/** Best-effort: a private window, cleared site data, or a full quota still leaves typing working. */
function readDraft(sessionId: string | undefined): IStoredDraft {
  try {
    return parseStoredDraft(window.localStorage.getItem(draftStorageKey(sessionId)));
  } catch {
    // allow-fallback: storage unavailable — the draft still lives in component state this session.
    return EMPTY_DRAFT;
  }
}

function writeDraft(sessionId: string | undefined, value: IStoredDraft): void {
  try {
    const key = draftStorageKey(sessionId);
    if (!value.text && value.attachments.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
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
    onCommand: (name: string, args?: string) => void;
    catalog: TCommandCatalog | null;
    status: TSessionStatus | null;
    /**
     * False while the transport is not `connected` (issue #3280 §5): Enter and Send refuse to submit,
     * and nothing typed is cleared or lost — the composer never sends into a socket that is not there.
     * #3282 §2 (part 2): the status chips and the `/` command menu are disabled the same way.
     */
    connected?: boolean;
    /** #3280 §2: a turn (or a blocking command) is running — Send becomes Stop and Esc stops it too. */
    running: boolean;
    onStop: () => void;
    /** #3280 §2: the prompt queued behind the running turn, or null when none is queued. */
    queued: IQueuedPrompt | null;
    onCancelQueue: () => void;
    /**
     * Opens the host's native multi-file dialog with real filesystem paths — present only on the
     * desktop app (#3282 §4d). Its absence means the attach button falls back to a plain HTML file
     * picker, whose picks a browser can never resolve to a path (rule 3: shown plainly, nothing
     * attached).
     */
    pickFiles?: () => Promise<readonly IPickedFile[]>;
    /**
     * Resolves a dropped or picked `File` to its real filesystem path — present only on the desktop
     * app, via Electron's `webUtils.getPathForFile` (#3282 §4d). Its absence means a drop can never
     * become an `@`-reference either.
     */
    getPathForFile?: (file: File) => string;
    /** #3282 §2 (part 2): the model control's pop-up menu — null until requested. */
    modelList?: TModelListSnapshot | null;
    onRequestModelList?: () => void;
    /** Applies a model/mode/effort choice without a conversation card (the control's label confirms it). */
    onSilentCommand?: (name: string, args?: string) => void;
  }
>(function Composer(
  {
    onSubmit,
    onCommand,
    catalog,
    status,
    connected = true,
    running,
    onStop,
    queued,
    onCancelQueue,
    pickFiles,
    getPathForFile,
    modelList = null,
    onRequestModelList = () => {},
    onSilentCommand = onCommand,
  },
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
  // The draft (text + attachments) as last set, read inside effects/handlers without depending on
  // component state and risking a stale closure — kept in lockstep with the `draft`/`attachments`
  // state below by `setDraft`/`setAttachments`, the only two places that mutate it.
  const stateRef = useRef<IStoredDraft>(EMPTY_DRAFT);
  const [draft, setDraftState] = useState(() => {
    const initial = readDraft(sessionId);
    stateRef.current = initial;
    return initial.text;
  });
  const [attachments, setAttachmentsState] = useState<readonly IDraftAttachment[]>(
    () => stateRef.current.attachments,
  );
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // #3282 §2 (part 2): the slash menu is disabled while disconnected — none of its commands could run.
  const menu = dismissed || !connected ? null : commandMenuFor(catalog, draft);
  useEffect(() => {
    setSelected(0);
    setDismissed(false);
  }, [draft]);
  // #3282 §4e: the menu can hold more rows than fit in its scroll area — keyboard navigation (below)
  // must keep the highlighted row in view, not just move the highlight off-screen.
  const menuOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    menuOptionRefs.current[selected]?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, menu]);
  /** #3280 §4: every draft change is persisted at once, so a reload or relaunch loses nothing. */
  const setDraft = (value: string): void => {
    stateRef.current = { ...stateRef.current, text: value };
    setDraftState(value);
    writeDraft(sessionIdRef.current, stateRef.current);
  };
  /** #3282 §4d: attachment chips persist alongside the text, under the same per-session draft key. */
  const setAttachments = (
    updater: readonly IDraftAttachment[] | ((current: readonly IDraftAttachment[]) => readonly IDraftAttachment[]),
  ): void => {
    const next = typeof updater === 'function' ? updater(stateRef.current.attachments) : updater;
    stateRef.current = { ...stateRef.current, attachments: next };
    setAttachmentsState(next);
    writeDraft(sessionIdRef.current, stateRef.current);
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
    const hasStored = stored.text !== '' || stored.attachments.length > 0;
    const hasCarryOver = stateRef.current.text !== '' || stateRef.current.attachments.length > 0;
    if (firstArrival && !hasStored && hasCarryOver) {
      writeDraft(sessionId, stateRef.current);
      writeDraft(previous, EMPTY_DRAFT);
      return;
    }
    stateRef.current = stored;
    setDraftState(stored.text);
    setAttachmentsState(stored.attachments);
    setAttachmentNotice(null); // a notice belongs to the attempt just made in the session left behind
  }, [sessionId]);

  const submit = (): void => {
    if (!connected) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    onSubmit(buildPromptWithAttachments(text, attachments));
    setDraft('');
    setAttachments([]);
    setAttachmentNotice(null);
  };
  const workspacePath = status?.workspace?.path;
  const totalAttachedBytes = attachments.reduce((sum, a) => sum + a.size, 0);
  /** Evaluate every dropped/picked file in order, so a mixed batch attaches what it can. */
  const addCandidates = (candidates: readonly ICandidateFile[]): void => {
    if (candidates.length === 0) return;
    let total = totalAttachedBytes;
    let count = attachments.length;
    const added: IDraftAttachment[] = [];
    let notice: string | null = null;
    for (const candidate of candidates) {
      const outcome = evaluateCandidateFile(candidate, workspacePath, total, count);
      if (outcome.kind === 'attached') {
        added.push(outcome.attachment);
        total += outcome.attachment.size;
        count += 1;
      } else {
        notice = outcome.message;
      }
    }
    if (added.length > 0) setAttachments((current) => [...current, ...added]);
    setAttachmentNotice(notice);
  };
  const removeAttachment = (id: string): void => {
    setAttachments((current) => current.filter((a) => a.id !== id));
  };
  const toCandidateFromFile = (file: File): ICandidateFile => ({
    name: file.name,
    size: file.size,
    mimeType: file.type || undefined,
    absolutePath: getPathForFile ? getPathForFile(file) || undefined : undefined,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAttachClick = (): void => {
    if (!connected) return;
    if (pickFiles) {
      pickFiles()
        .then((picked) =>
          addCandidates(picked.map((f) => ({ name: f.name, size: f.size, absolutePath: f.path }))),
        )
        // The host's dialog IPC can reject (e.g. the window closed mid-pick) — say so rather than
        // leaving an unhandled rejection and a button that silently did nothing (rule 5: never fail
        // silently).
        .catch(() => setAttachmentNotice('Could not open the file picker. Try again.'));
      return;
    }
    fileInputRef.current?.click();
  };
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow picking the same (rejected) file again after fixing it
    addCandidates(files.map(toCandidateFromFile));
  };
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const hasFilesDrag = (event: React.DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const onDragEnter = (event: React.DragEvent): void => {
    if (!connected || !hasFilesDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  };
  const onDragOver = (event: React.DragEvent): void => {
    if (!connected || !hasFilesDrag(event)) return;
    event.preventDefault(); // required for onDrop to fire
  };
  const onDragLeave = (): void => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  };
  const onDrop = (event: React.DragEvent): void => {
    if (!connected || !hasFilesDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    addCandidates(Array.from(event.dataTransfer?.files ?? []).map(toCandidateFromFile));
  };
  /** Choosing a command from the menu, by mouse or by keyboard (`acceptMenu` below). */
  const chooseMenuItem = (item: ICommandMenuItem): void => {
    if (isImmediateScreenCommand(item)) {
      setDraft('');
      onCommand(item.name);
      return;
    }
    setDraft(`/${item.name} `);
  };
  /** Complete the highlighted name; a draft that already names it is sent instead. A command whose
   *  whole job is opening a screen runs at once either way — see `IMMEDIATE_SCREEN_COMMANDS`. */
  const acceptMenu = (): boolean => {
    const item = menu?.[selected];
    if (!item) return false;
    if (!isImmediateScreenCommand(item) && draft === `/${item.name}`) return false;
    chooseMenuItem(item);
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
    <div
      className="relative flex-shrink-0"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* #3282 §4d rule 7: the drop target is announced even to someone who cannot drag a file —
          the attach button beside the textarea is how they reach the same result. */}
      <p id="composer-attach-hint" className="sr-only">
        Drag files here, or use Attach files, to add them to your message.
      </p>
      {isDraggingFiles && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[22px] border-2 border-dashed border-accent bg-accent/10 text-[14px] font-medium text-accent"
        >
          Drop to attach
        </div>
      )}
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
            // #3282 §4e: "Commands" then "Skills" — a header appears once, above the first row of
            // its group (the menu always lists every command before every skill, so a group's rows
            // are contiguous).
            const showGroupHeader = index === 0 || menuGroupLabel(menu[index - 1]!) !== menuGroupLabel(item);
            return (
              <div key={`${item.kind}:${item.name}`}>
                {showGroupHeader && (
                  <div
                    role="presentation"
                    className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle first:pt-1"
                  >
                    {menuGroupLabel(item)}
                  </div>
                )}
                <button
                  ref={(el) => {
                    menuOptionRefs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === selected}
                  onMouseEnter={() => setSelected(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    chooseMenuItem(item);
                  }}
                  className={`flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left text-[14px] ${
                    index === selected ? 'bg-hover' : ''
                  }`}
                >
                  <span className="flex-shrink-0 font-mono text-[13.5px] text-foreground">
                    /{item.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {item.description}
                  </span>
                </button>
              </div>
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
        {attachments.length > 0 && (
          <ul
            aria-label="attachments"
            className="mb-1.5 flex flex-wrap gap-1.5 px-1 pt-0.5"
          >
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                title={attachment.relativePath}
                className="flex max-w-full items-center gap-1.5 rounded-lg bg-raised px-2 py-1 text-[12.5px] text-muted-foreground"
              >
                <Paperclip size={12} strokeWidth={1.75} aria-hidden="true" className="flex-shrink-0" />
                <span className="max-w-[180px] truncate">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => removeAttachment(attachment.id)}
                  className="flex-shrink-0 rounded-full p-0.5 hover:bg-hover hover:text-foreground"
                >
                  <X size={12} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {attachmentNotice && (
          <p role="status" aria-live="polite" className="mb-1.5 px-1.5 text-[12.5px] text-muted-foreground">
            {attachmentNotice}
          </p>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInputChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <textarea
          ref={textareaRef}
          aria-label="message"
          aria-describedby="composer-attach-hint"
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
          <button
            type="button"
            aria-label="Attach files"
            // #3282 §2 (part 2): the attach button follows the same disconnected rule as the status
            // chips and the `/` menu — a short "Reconnecting…" tooltip in place of its usual one.
            title={connected ? 'Attach files' : 'Reconnecting…'}
            disabled={!connected}
            onClick={handleAttachClick}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-hover hover:text-foreground disabled:text-subtle disabled:hover:bg-transparent"
          >
            <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <StatusRow
            status={status}
            catalog={catalog}
            modelList={modelList}
            onRequestModelList={onRequestModelList}
            onCommand={onCommand}
            onSilentCommand={onSilentCommand}
            connected={connected}
          />
          <button
            type={running ? 'button' : 'submit'}
            onClick={running ? onStop : undefined}
            // Stop is unavailable while disconnected too: an abort could not reach the host either.
            disabled={!connected || (!running && !draft.trim() && attachments.length === 0)}
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

// `StatusRow` (model/mode/effort pop-up menus) and its `ContextRing` moved to `StatusControls.tsx`
// (#3282 §2 part 2) — imported above.
