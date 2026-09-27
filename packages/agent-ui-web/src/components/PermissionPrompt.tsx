'use client';

import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { TPendingPrompt } from '../hooks/prompt-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';

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
 * submits it, and its own keys never reach the prompt's shortcuts (#3280 §3).
 */
interface IPermissionPromptProps {
  prompts: readonly TPendingPrompt[];
  onAnswerPermission: (id: string, result: boolean) => void;
  onAnswerAsk: (id: string, response: TActionResponse) => void;
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
  // there type into the field rather than choosing a numbered option, so the hint must say so.
  const [fieldFocused, setFieldFocused] = useState(false);
  const [freeText, setFreeText] = useState('');
  // Set at the moment of an answer if focus was inside the prompt then; consumed once the prompt list
  // empties (see below) or cleared once a next prompt shows it was not needed after all.
  const pendingFocusReturnRef = useRef(false);
  useEffect(() => {
    if (promptId === undefined || armDelayMs <= 0) return undefined;
    const timer = setTimeout(() => setArmedId(promptId), armDelayMs);
    return () => clearTimeout(timer);
  }, [promptId, armDelayMs]);
  const armed = promptId !== undefined && (armDelayMs <= 0 || armedId === promptId);
  // A new prompt starts with an empty field, whatever the last one's typed (or masked) value was.
  useEffect(() => {
    setFreeText('');
  }, [promptId]);
  // Answering one prompt renders the next into the same buttons, so a button focused to answer the
  // last one would take Enter, Space or a held key as an answer to this one. Focus goes back to the
  // prompt itself, whose keys wait for the prompt to arm.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const active = document.activeElement;
    if (container && active && active !== container && container.contains(active)) {
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
  const requester =
    prompt.requesterDriverId && prompt.requesterDriverId !== 'owner'
      ? prompt.requesterDriverId
      : undefined;
  const shortRequester =
    requester && requester.length > 12 ? `${requester.slice(0, 8)}…` : requester;

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
  const answerAsk = (id: string, response: TActionResponse): void => {
    rememberFocus();
    onAnswerAsk(id, response);
  };
  /** The typed value, trimmed as the runtime's own text-prompt renderers do; blocked while empty. */
  const submitFreeText = (): void => {
    if (prompt.kind !== 'ask') return;
    const value = freeText.trim();
    if (!value && prompt.request.allowEmpty !== true) return;
    answerAsk(prompt.id, { type: 'answer', values: [], text: value });
    setFreeText('');
  };
  /** A click anywhere in the prompt that isn't on a button or the field itself focuses the field. */
  const onContainerClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!hasFreeText) return;
    if ((event.target as HTMLElement).closest('button, input')) return;
    fieldRef.current?.focus();
  };
  /**
   * A key that reaches the field types into it — the prompt's own shortcuts never see it (#3280 §3).
   * The Enter that only finishes an IME composition (Korean/Japanese/Chinese) must not submit the
   * still-uncommitted text — `isComposing` (or `keyCode` 229, on browsers that predate it) marks that
   * Enter; the keystroke is left alone so the browser can commit the composition normally.
   */
  const onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    if (prompt.kind !== 'ask') return;
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      submitFreeText();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      answerAsk(prompt.id, { type: 'cancelled' });
    }
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
                  {shortRequester && (
                    <>
                      {' '}
                      · from driver <span className="text-foreground">{shortRequester}</span>
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-[15px] font-medium text-foreground">
                  Allow <span className="font-semibold">{prompt.toolName}</span> to run?
                </p>
                <ToolArgs args={prompt.toolArgs} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 pl-11">
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={onButton(() => answerPermission(prompt.id, true))}
              >
                <span>Allow</span>
                {dock && <Kbd>1</Kbd>}
              </button>
              <button
                type="button"
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
                {shortRequester && (
                  <p className="text-[13px] text-muted-foreground">
                    from driver <span className="text-foreground">{shortRequester}</span>
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
                  <div className="flex items-center gap-2">
                    <input
                      ref={fieldRef}
                      type={prompt.request.masked ? 'password' : 'text'}
                      autoComplete="off"
                      aria-label="answer"
                      placeholder={prompt.request.placeholder}
                      value={freeText}
                      onChange={(event) => setFreeText(event.target.value)}
                      onKeyDown={onFieldKeyDown}
                      onFocus={() => setFieldFocused(true)}
                      onBlur={() => setFieldFocused(false)}
                      className="min-w-0 flex-1 rounded-lg bg-sidebar px-3 py-1.5 text-[14px] text-foreground placeholder:text-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <button
                      type="button"
                      className={PRIMARY_BUTTON}
                      disabled={!freeText.trim() && prompt.request.allowEmpty !== true}
                      onClick={onButton(submitFreeText)}
                    >
                      Continue
                    </button>
                  </div>
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
