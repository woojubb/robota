'use client';

import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { driverAttributionText, isSameSurface } from '../driver-labels.js';
import { DiffLines } from './DiffLines.js';

import type { TPendingPrompt } from '../hooks/prompt-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';
import type { TDriverId } from '@robota-sdk/agent-interface-session';

/**
 * Renders the owner's pending permission/ask prompts (REMOTE-007/009). Under local == remote the paired
 * browser owner answers its OWN prompts; the first pending prompt is shown. A gated tool call blocks
 * until answered, so this is on the critical path — not decorative.
 *
 * `modal` covers the page; `dock` sits above the composer, as desktop agent apps place a pending
 * question next to where the answer is typed. Once armed and focused, its keys answer it: 1–9 picks
 * an option, Esc cancels a question or denies a permission — but it never takes that focus away from
 * a field the person is typing in (#3280 §1). A click on a button always answers at once. An ask whose
 * request sets `allowFreeText` also shows a text field (masked when `masked` is set); Enter there
 * submits it, and its own keys never reach the prompt's shortcuts (#3280 §3). The field's typed value
 * lives only in `FreeTextField`, keyed by `prompt.id`: a cancelled or answered prompt's text can
 * never reach the next prompt's render, masked or not, because the field is a fresh component
 * instance rather than a value carried over in this component's own state (#3280 §3 follow-up).
 */
interface IPermissionPromptProps {
  prompts: readonly TPendingPrompt[];
  onAnswerPermission: (id: string, result: boolean) => void;
  onAnswerAsk: (id: string, response: TActionResponse) => void;
  /** This connection's own driver id (§3289 §3): a prompt raised by its own turn shows no requester. */
  ownDriverId?: TDriverId | null;
  layout?: 'modal' | 'dock';
  /** How long a new prompt waits before its keys answer it; tests pass their own. */
  armDelayMs?: number;
  /**
   * Called once an answer (click or key) leaves no prompt behind, if focus was inside this prompt at
   * the time — so the caller can send it back to the field the person was typing in (the composer,
   * for the `dock` layout). Not called when another prompt immediately follows: focus stays on the
   * prompt for that one instead.
   */
  onFocusReturn?: () => void;
}

/**
 * A prompt can appear while the user is typing in a field. For this long after it appears the prompt
 * leaves focus where it is, so the keystrokes land there instead of answering (`1` allows). A mouse
 * click on a button still answers at once, and Esc still denies or cancels, because both are
 * deliberate. A click made with the keyboard (Enter or Space on a focused button) waits for the
 * prompt to arm like any other key.
 */
export const PROMPT_ARM_DELAY_MS = 450;

/** An element whose keystrokes the person relies on — a prompt must never take focus from one of these. */
function isEditableElement(element: Element | null): boolean {
  return element !== null && element.matches('input, textarea, select, [contenteditable]');
}

export function PermissionPrompt({
  prompts,
  onAnswerPermission,
  onAnswerAsk,
  ownDriverId = null,
  layout = 'modal',
  armDelayMs = PROMPT_ARM_DELAY_MS,
  onFocusReturn,
}: IPermissionPromptProps): React.ReactElement | null {
  const prompt = prompts[0];
  const promptId = prompt?.id;
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // A question with a text field (#3280 §3): the field is the prompt's primary control, so focus goes
  // there instead of the container wherever this component would otherwise focus the container itself.
  const hasFreeText = prompt?.kind === 'ask' && prompt.request.allowFreeText === true;
  const [armedId, setArmedId] = useState<string | undefined>(undefined);
  const [hasFocus, setHasFocus] = useState(false);
  // Whether the field itself (not just some part of the prompt) currently holds focus — digits typed
  // there type into the field rather than choosing a numbered option, so the hint must say so. Lifted
  // from `FreeTextField` via `onFocusChange`, since the hint text is rendered up here.
  const [fieldFocused, setFieldFocused] = useState(false);
  // Imperative escape hatch onto the field's own state (see `FreeTextField`): every path that ends
  // this prompt clears it explicitly, rather than relying on the field ever being asked to render a
  // value that belongs to a prompt other than the one it was mounted for.
  const fieldHandleRef = useRef<IFreeTextFieldHandle>(null);
  // Set at the moment of an answer if focus was inside the prompt then; consumed once the prompt list
  // empties (see below) or cleared once a next prompt shows it was not needed after all.
  const pendingFocusReturnRef = useRef(false);
  useEffect(() => {
    if (promptId === undefined || armDelayMs <= 0) return undefined;
    const timer = setTimeout(() => setArmedId(promptId), armDelayMs);
    return () => clearTimeout(timer);
  }, [promptId, armDelayMs]);
  const armed = promptId !== undefined && (armDelayMs <= 0 || armedId === promptId);
  // Answering one prompt renders the next into the same buttons, so a button focused to answer the
  // last one would take Enter, Space or a held key as an answer to this one. Focus goes back to the
  // prompt itself, whose keys wait for the prompt to arm. A reused button is still there to find this
  // way — but the free-text field is its own component, remounted (not updated) for the new prompt.id
  // (#3280 §3 follow-up), and removing a focused DOM node drops focus to <body> as an intrinsic side
  // effect, before this effect ever runs. `pendingFocusReturnRef` (set at answer time, and not yet
  // cleared — the effect that clears it is a passive one, ordered after this layout effect) still
  // remembers that focus was in this prompt, so that case is reclaimed too.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const active = document.activeElement;
    const focusStillInside = !!(active && active !== container && container.contains(active));
    const focusJustLeftOnRemount = pendingFocusReturnRef.current && active === document.body;
    if (focusStillInside || focusJustLeftOnRemount) {
      container.focus();
    }
  }, [promptId]);
  // Once armed the prompt takes focus, so its keys answer it rather than type wherever the person
  // already is — UNLESS that is an editable field, whose keystrokes must never be stolen (#3280 §1).
  useEffect(() => {
    if (!armed) return;
    if (isEditableElement(document.activeElement)) return;
    (hasFreeText ? fieldRef.current : containerRef.current)?.focus();
  }, [armed, promptId, hasFreeText]);
  // An answer given while focus was inside this prompt sends it back to the composer once no prompt is
  // left to show it — unless another one immediately follows (handled above by keeping focus in place).
  useEffect(() => {
    if (promptId !== undefined) {
      pendingFocusReturnRef.current = false;
      return;
    }
    setHasFocus(false);
    if (pendingFocusReturnRef.current) {
      pendingFocusReturnRef.current = false;
      onFocusReturn?.();
    }
  }, [promptId, onFocusReturn]);
  if (!prompt) return null;

  // REMOTE-014 E5 (display-only): the prompt belongs to the driver whose turn raised it. Shown so the owner
  // can tell a co-driver's tool-gate from their own — it NEVER changes who is authorized to answer (owner).
  const requesterLabel =
    prompt.requesterDriverId && !isSameSurface(prompt.requesterDriverId, ownDriverId)
      ? driverAttributionText(prompt.requesterDriverId)
      : undefined;

  const dock = layout === 'dock';
  /** Records whether the answer being given leaves the prompt able to hand focus back afterwards. */
  const rememberFocus = (): void => {
    const container = containerRef.current;
    const active = document.activeElement;
    pendingFocusReturnRef.current = !!(container && active && container.contains(active));
  };
  const answerPermission = (id: string, result: boolean): void => {
    rememberFocus();
    onAnswerPermission(id, result);
  };
  // Every ask answer — submit, Cancel, Esc (in the field or at the dock), or picking an option while
  // text sits untyped in the field — clears whatever the field holds first. `FreeTextField` also
  // clears itself on its own submit/Esc paths; this is the single choke point that covers the rest
  // (the Cancel button, the dock's Esc, and answering by option) without every call site repeating it.
  const answerAsk = (id: string, response: TActionResponse): void => {
    rememberFocus();
    fieldHandleRef.current?.clear();
    onAnswerAsk(id, response);
  };
  /** A click anywhere in the prompt that isn't on a button or the field itself focuses the field. */
  const onContainerClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!hasFreeText) return;
    if ((event.target as HTMLElement).closest('button, input')) return;
    fieldRef.current?.focus();
  };
  /** A mouse click answers at once; a keyboard click (`detail` 0) waits for the prompt to arm. */
  const onButton =
    (answer: () => void) =>
    (event: React.MouseEvent): void => {
      if (!armed && event.detail === 0) return;
      answer();
    };
  const onDockKey = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (prompt.kind === 'permission') answerPermission(prompt.id, false);
      else answerAsk(prompt.id, { type: 'cancelled' });
      return;
    }
    // A key that reaches a prompt still arming (it kept focus from the one before) is dropped.
    if (!armed) return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0) return;
    if (prompt.kind === 'permission') {
      if (index < 2) answerPermission(prompt.id, index === 0);
      return;
    }
    const option = prompt.request.options?.[index];
    if (option) answerAsk(prompt.id, { type: 'answer', values: [option.value] });
  };
  // #3288: an Edit/Write request carries the same server-built diff `tool_end` would show.
  const hasDiff = prompt.kind === 'permission' && (prompt.diffLines?.length ?? 0) > 0;
  const shellCommand =
    prompt.kind === 'permission' && typeof prompt.toolArgs['command'] === 'string'
      ? prompt.toolArgs['command']
      : undefined;
  const isShellCommand = prompt.kind === 'permission' && prompt.toolName === 'Bash' && shellCommand !== undefined;
  const askOptions = prompt.kind === 'ask' ? (prompt.request.options ?? []) : [];
  // Digits choose an option only while focus is on the prompt itself, not the field — a hint promising
  // "1–9 choose" while the field holds focus would be wrong, since digits type there instead.
  const askArmedHint =
    hasFreeText && fieldFocused
      ? 'Enter to submit · Esc to cancel'
      : askOptions.length > 0
        ? '1–9 choose · Esc cancel'
        : 'Esc cancels';
  return (
    <div
      className={
        dock
          ? 'robota-ui gui-rise flex-shrink-0'
          : 'robota-ui fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]'
      }
    >
      <div
        ref={containerRef}
        tabIndex={dock ? 0 : -1}
        onKeyDown={dock ? onDockKey : undefined}
        onClick={onContainerClick}
        onFocus={() => setHasFocus(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setHasFocus(false);
          }
        }}
        role="dialog"
        aria-label="pending question"
        data-armed={dock ? String(armed) : undefined}
        className={`w-full rounded-2xl bg-card text-[14px] text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          dock ? 'p-4' : 'max-w-lg p-5'
        }`}
      >
        {prompt.kind === 'permission' ? (
          <>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
                <ShieldAlert size={17} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-muted-foreground">
                  Permission request
                  {requesterLabel && (
                    <>
                      {' '}
                      · <span className="text-foreground">{requesterLabel}</span>
                    </>
                  )}
                </p>
                {/* #3288 §2: an Edit/Write request with a server-built diff preview shows "Edit
                    <path>" and the diff, in place of "Allow <tool> to run?" and raw arguments.
                    Issue #3288 §1: short of that, a background agent's own request names it, so
                    this reads as a question about someone else's action, not an unattributed ask. */}
                {hasDiff ? (
                  <p className="mt-0.5 text-[15px] font-medium text-foreground">
                    {prompt.toolName}{' '}
                    <span className="font-mono font-semibold">{prompt.diffFile}</span>
                  </p>
                ) : prompt.requester?.kind === 'background-agent' ? (
                  <p className="mt-0.5 text-[15px] font-medium text-foreground">
                    Background agent <span className="font-semibold">{prompt.requester.label}</span>{' '}
                    wants to run <span className="font-semibold">{prompt.toolName}</span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-[15px] font-medium text-foreground">
                    Allow <span className="font-semibold">{prompt.toolName}</span> to run?
                  </p>
                )}
                {hasDiff ? (
                  <div className="mt-2.5">
                    <DiffLines diffLines={prompt.diffLines!} />
                  </div>
                ) : isShellCommand ? (
                  <ShellCommandPreview command={shellCommand} cwd={prompt.cwd} />
                ) : (
                  <ToolArgs args={prompt.toolArgs} />
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 pl-11">
              <button
                type="button"
                aria-keyshortcuts={dock ? '1' : undefined}
                className={PRIMARY_BUTTON}
                onClick={onButton(() => answerPermission(prompt.id, true))}
              >
                <span>Allow</span>
                {dock && <Kbd>1</Kbd>}
              </button>
              <button
                type="button"
                aria-keyshortcuts={dock ? '2' : undefined}
                className={SECONDARY_BUTTON}
                onClick={onButton(() => answerPermission(prompt.id, false))}
              >
                <span>Deny</span>
                {dock && <Kbd>2</Kbd>}
              </button>
              {dock && (
                <KeyHint hasFocus={hasFocus} armed={armed} armedText="1 allow · 2 deny · Esc deny" />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <MessageCircleQuestion size={17} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                {requesterLabel && (
                  <p className="text-[13px] text-muted-foreground">
                    <span className="text-foreground">{requesterLabel}</span>
                  </p>
                )}
                <p className="text-[15px] font-medium text-foreground">{prompt.request.title}</p>
                {prompt.request.description ? (
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    {prompt.request.description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 pl-11">
              {askOptions.length > 0 && (
                <div className="flex flex-wrap items-start gap-3">
                  {askOptions.map((opt, index) => (
                    <div key={opt.value} className="flex flex-col items-start gap-0.5">
                      <button
                        type="button"
                        aria-keyshortcuts={dock && index < 9 ? String(index + 1) : undefined}
                        className={index === 0 ? PRIMARY_BUTTON : SECONDARY_BUTTON}
                        onClick={onButton(() =>
                          answerAsk(prompt.id, { type: 'answer', values: [opt.value] }),
                        )}
                      >
                        <span>{opt.label}</span>
                        {dock && index < 9 && <Kbd>{index + 1}</Kbd>}
                      </button>
                      {opt.description && (
                        <p className="pl-0.5 text-[11.5px] leading-snug text-subtle">
                          {opt.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {hasFreeText && (
                <div className="flex flex-col gap-1.5">
                  {askOptions.length > 0 && (
                    <p className="text-[12.5px] text-subtle">or type an answer</p>
                  )}
                  <FreeTextField
                    // Remounts on every new prompt — no value typed for one question can ever appear
                    // in the DOM for another, masked or not, since this is a fresh component instance
                    // with its own fresh `useState('')`, not a value this component reset in an effect.
                    key={prompt.id}
                    ref={fieldHandleRef}
                    inputRef={fieldRef}
                    masked={prompt.request.masked === true}
                    placeholder={prompt.request.placeholder}
                    allowEmpty={prompt.request.allowEmpty === true}
                    wrapClick={onButton}
                    onSubmit={(value) =>
                      answerAsk(prompt.id, { type: 'answer', values: [], text: value })
                    }
                    onCancel={() => answerAsk(prompt.id, { type: 'cancelled' })}
                    onFocusChange={setFieldFocused}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={GHOST_BUTTON}
                  onClick={onButton(() => answerAsk(prompt.id, { type: 'cancelled' }))}
                >
                  Cancel
                </button>
                {dock && (
                  <KeyHint hasFocus={hasFocus} armed={armed} armedText={askArmedHint} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const BUTTON =
  'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[14px] font-medium transition-colors';
const PRIMARY_BUTTON = `${BUTTON} bg-primary text-primary-foreground hover:opacity-90`;
const SECONDARY_BUTTON = `${BUTTON} bg-raised text-foreground hover:bg-hover`;
const GHOST_BUTTON = `${BUTTON} text-muted-foreground hover:bg-hover hover:text-foreground`;

/** Imperative escape hatch a parent can use to wipe the field's value without owning it. */
interface IFreeTextFieldHandle {
  clear: () => void;
}

interface IFreeTextFieldProps {
  masked: boolean;
  placeholder?: string;
  /** An empty answer is otherwise blocked, mirroring the runtime's own text-prompt renderers. */
  allowEmpty: boolean;
  /** The field's own DOM node, so the parent can move focus onto it once the prompt arms. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The parent's mouse-vs-keyboard-click gate (`armed`), applied to this field's own button. */
  wrapClick: (answer: () => void) => (event: React.MouseEvent) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  onFocusChange: (focused: boolean) => void;
}

/**
 * The free-text answer to one ask prompt. Its value lives ONLY here, in a component the parent
 * mounts with `key={prompt.id}` — so a cancelled or answered prompt's typed (possibly masked, e.g.
 * an API key) text cannot survive into another prompt's render: there is no shared state to carry it,
 * only a fresh `useState('')` on the next prompt's fresh instance. `clear` is exposed via `ref` as a
 * second line of defense, so the parent can wipe the value at the moment ANY answer is given (Cancel,
 * an option pick, the dock's Esc) and not only from the paths already local to this component (submit,
 * Esc-in-field) — belt and suspenders, not a substitute for the remount.
 */
const FreeTextField = forwardRef<IFreeTextFieldHandle, IFreeTextFieldProps>(function FreeTextField(
  { masked, placeholder, allowEmpty, inputRef, wrapClick, onSubmit, onCancel, onFocusChange },
  ref,
) {
  const [value, setValue] = useState('');
  useImperativeHandle(ref, () => ({ clear: () => setValue('') }), []);
  /** The typed value, trimmed as the runtime's own text-prompt renderers do; blocked while empty. */
  const submit = (): void => {
    const trimmed = value.trim();
    if (!trimmed && !allowEmpty) return;
    setValue('');
    onSubmit(trimmed);
  };
  const cancel = (): void => {
    setValue('');
    onCancel();
  };
  /**
   * A key that reaches the field types into it — the prompt's own shortcuts never see it (#3280 §3).
   * The Enter that only finishes an IME composition (Korean/Japanese/Chinese) must not submit the
   * still-uncommitted text — `isComposing` (or `keyCode` 229, on browsers that predate it) marks that
   * Enter; the keystroke is left alone so the browser can commit the composition normally.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };
  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type={masked ? 'password' : 'text'}
        autoComplete="off"
        aria-label="answer"
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        className="min-w-0 flex-1 rounded-lg bg-sidebar px-3 py-1.5 text-[14px] text-foreground placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <button
        type="button"
        className={PRIMARY_BUTTON}
        disabled={!value.trim() && !allowEmpty}
        onClick={wrapClick(submit)}
      >
        Continue
      </button>
    </div>
  );
});

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    // Hidden from the accessible name: the button is "Allow", and the hint line says which key answers.
    <kbd
      aria-hidden="true"
      className="rounded bg-foreground/10 px-1 font-mono text-[11px] leading-[1.45] opacity-70"
    >
      {children}
    </kbd>
  );
}

function KeyHint({
  hasFocus,
  armed,
  armedText,
}: {
  hasFocus: boolean;
  armed: boolean;
  /** What the prompt's keys do once armed — differs by kind and by whether it offers free text. */
  armedText: string;
}): React.ReactElement {
  const text = !hasFocus
    ? 'Click to answer, or press Shift+Tab to use the keys'
    : armed
      ? armedText
      : 'keys answer in a moment · click to answer now';
  return <p className="ml-auto text-[12.5px] text-subtle">{text}</p>;
}

/**
 * Everything the tool was asked to do, since that is what the owner approves: a command line first, as it
 * is, then every other argument (where it runs, what it is fed) as `key: value`. Nothing is cut; a long
 * block scrolls.
 */
function ToolArgs({ args }: { args: unknown }): React.ReactElement | null {
  if (args === null || typeof args !== 'object') return null;
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return null;
  const commandKey = entries.find(
    ([key, value]) => (key === 'command' || key === 'cmd') && typeof value === 'string',
  )?.[0];
  const rest = entries.filter(([key]) => key !== commandKey);
  const format = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="mt-2.5 max-h-48 overflow-auto rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed">
      {commandKey ? (
        <pre className="whitespace-pre-wrap break-all text-foreground">
          {(args as Record<string, string>)[commandKey]}
        </pre>
      ) : null}
      {rest.length > 0 ? (
        <dl className={`text-muted-foreground ${commandKey ? 'mt-1.5' : ''}`}>
          {rest.map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <dt className="flex-shrink-0 text-subtle">{key}:</dt>
              <dd className="min-w-0 whitespace-pre-wrap break-all">{format(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * #3288: a Shell request shows just its command — and the working directory only when the server
 * says it differs from the workspace — instead of every raw argument.
 */
function ShellCommandPreview({
  command,
  cwd,
}: {
  command: string;
  cwd?: string;
}): React.ReactElement {
  return (
    <div className="mt-2.5 max-h-48 overflow-auto rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed">
      <pre className="whitespace-pre-wrap break-all text-foreground">{command}</pre>
      {cwd && (
        <p className="mt-1.5 text-muted-foreground">
          <span className="text-subtle">in </span>
          {cwd}
        </p>
      )}
    </div>
  );
}
