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
 * question next to where the answer is typed. Once armed it takes focus: 1–9 picks an option, Esc
 * cancels a question or denies a permission.
 */
interface IPermissionPromptProps {
  prompts: readonly TPendingPrompt[];
  onAnswerPermission: (id: string, result: boolean) => void;
  onAnswerAsk: (id: string, response: TActionResponse) => void;
  layout?: 'modal' | 'dock';
  /** How long a new prompt waits before its keys answer it; tests pass their own. */
  armDelayMs?: number;
}

/**
 * A prompt can appear while the user is typing in the composer. For this long after it appears the
 * dock leaves focus where it is, so the keystrokes land in the composer instead of answering (`1`
 * allows). A mouse click on a button still answers at once, and Esc still denies or cancels, because
 * both are deliberate. A click made with the keyboard (Enter or Space on a focused button) waits for
 * the prompt to arm like any other key.
 */
export const PROMPT_ARM_DELAY_MS = 450;

export function PermissionPrompt({
  prompts,
  onAnswerPermission,
  onAnswerAsk,
  layout = 'modal',
  armDelayMs = PROMPT_ARM_DELAY_MS,
}: IPermissionPromptProps): React.ReactElement | null {
  const prompt = prompts[0];
  const promptId = prompt?.id;
  const dockRef = useRef<HTMLDivElement>(null);
  const [armedId, setArmedId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (promptId === undefined || armDelayMs <= 0) return undefined;
    const timer = setTimeout(() => setArmedId(promptId), armDelayMs);
    return () => clearTimeout(timer);
  }, [promptId, armDelayMs]);
  const armed = promptId !== undefined && (armDelayMs <= 0 || armedId === promptId);
  // Answering one prompt renders the next into the same buttons, so a button focused to answer the
  // last one would take Enter, Space or a held key as an answer to this one. Focus goes back to the
  // dock itself, whose keys wait for the prompt to arm.
  useLayoutEffect(() => {
    const dockElement = dockRef.current;
    const active = document.activeElement;
    if (dockElement && active && active !== dockElement && dockElement.contains(active)) {
      dockElement.focus();
    }
  }, [promptId]);
  // Once armed the question takes focus, so its keys answer it rather than type into the composer.
  useEffect(() => {
    if (armed && layout === 'dock') dockRef.current?.focus();
  }, [armed, promptId, layout]);
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
      if (prompt.kind === 'permission') onAnswerPermission(prompt.id, false);
      else onAnswerAsk(prompt.id, { type: 'cancelled' });
      return;
    }
    // A key that reaches a prompt still arming (the dock kept focus from the one before) is dropped.
    if (!armed) return;
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0) return;
    if (prompt.kind === 'permission') {
      if (index < 2) onAnswerPermission(prompt.id, index === 0);
      return;
    }
    const option = prompt.request.options?.[index];
    if (option) onAnswerAsk(prompt.id, { type: 'answer', values: [option.value] });
  };
  return (
    <div
      className={
        dock
          ? 'gui-rise flex-shrink-0'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]'
      }
    >
      <div
        ref={dock ? dockRef : undefined}
        tabIndex={dock ? -1 : undefined}
        onKeyDown={dock ? onDockKey : undefined}
        role={dock ? 'dialog' : undefined}
        aria-label={dock ? 'pending question' : undefined}
        data-armed={dock ? String(armed) : undefined}
        className={`w-full rounded-2xl bg-card p-4 text-[14px] text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none ${
          dock ? '' : 'max-w-lg p-5'
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
                {argsSummary(prompt.toolArgs) ? (
                  <pre className="mt-2.5 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed text-muted-foreground">
                    {argsSummary(prompt.toolArgs)}
                  </pre>
                ) : null}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 pl-11">
              <button
                type="button"
                className={PRIMARY_BUTTON}
                onClick={onButton(() => onAnswerPermission(prompt.id, true))}
              >
                <span>Allow</span>
                {dock && <Kbd>1</Kbd>}
              </button>
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={onButton(() => onAnswerPermission(prompt.id, false))}
              >
                <span>Deny</span>
                {dock && <Kbd>2</Kbd>}
              </button>
              {dock && <KeyHint armed={armed} kind={prompt.kind} />}
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
            <div className="mt-4 flex flex-wrap items-center gap-2 pl-11">
              {(prompt.request.options ?? []).map((opt, index) => (
                <button
                  type="button"
                  key={opt.value}
                  className={index === 0 ? PRIMARY_BUTTON : SECONDARY_BUTTON}
                  onClick={onButton(() =>
                    onAnswerAsk(prompt.id, { type: 'answer', values: [opt.value] }),
                  )}
                >
                  <span>{opt.label}</span>
                  {dock && index < 9 && <Kbd>{index + 1}</Kbd>}
                </button>
              ))}
              <button
                type="button"
                className={GHOST_BUTTON}
                onClick={onButton(() => onAnswerAsk(prompt.id, { type: 'cancelled' }))}
              >
                Cancel
              </button>
              {dock && <KeyHint armed={armed} kind={prompt.kind} />}
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
    <kbd className="rounded bg-foreground/10 px-1 font-mono text-[11px] leading-[1.45] opacity-70">
      {children}
    </kbd>
  );
}

function KeyHint({
  armed,
  kind,
}: {
  armed: boolean;
  kind: TPendingPrompt['kind'];
}): React.ReactElement {
  return (
    <p className="ml-auto text-[12.5px] text-subtle">
      {armed
        ? `${kind === 'permission' ? '1 allow · 2 deny' : '1–9 choose'} · Esc ${kind === 'permission' ? 'deny' : 'cancel'}`
        : 'keys answer in a moment · click to answer now'}
    </p>
  );
}

/** What the tool was asked to do, in one readable block: a command line as it is, anything else as JSON. */
function argsSummary(args: unknown): string {
  if (args === null || typeof args !== 'object') return '';
  const record = args as Record<string, unknown>;
  const command = record['command'] ?? record['cmd'];
  if (typeof command === 'string') return command;
  const text = JSON.stringify(record, null, 2);
  if (text === '{}') return '';
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}
