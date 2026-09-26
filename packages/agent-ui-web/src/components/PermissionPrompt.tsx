'use client';

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
          ? 'gui-rise flex-shrink-0 px-3 pt-2'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      }
    >
      <div
        ref={dock ? dockRef : undefined}
        tabIndex={dock ? -1 : undefined}
        onKeyDown={dock ? onDockKey : undefined}
        role={dock ? 'dialog' : undefined}
        aria-label={dock ? 'pending question' : undefined}
        data-armed={dock ? String(armed) : undefined}
        className={
          dock
            ? `w-full rounded-xl border bg-card p-4 font-mono text-[13px] shadow-lg shadow-black/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${
                armed ? 'border-primary/60' : 'border-border/70'
              }`
            : 'w-full max-w-md rounded-lg bg-[var(--card)] p-5 font-mono text-[13px] shadow-xl'
        }
      >
        {shortRequester && (
          <p className="mb-2 text-[11px] text-[var(--muted-foreground)]">
            from driver <span className="text-[var(--foreground)]">{shortRequester}</span>
          </p>
        )}
        {prompt.kind === 'permission' ? (
          <>
            <p className="mb-1 font-bold text-[var(--foreground)]">Permission request</p>
            <p className="mb-4 text-[var(--muted-foreground)]">
              Allow <span className="text-[var(--foreground)]">{prompt.toolName}</span> to run?
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-white"
                onClick={onButton(() => onAnswerPermission(prompt.id, true))}
              >
                Allow
              </button>
              <button
                type="button"
                className="rounded-md bg-rose-600 px-3 py-1.5 text-white"
                onClick={onButton(() => onAnswerPermission(prompt.id, false))}
              >
                Deny
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-1 font-bold text-[var(--foreground)]">{prompt.request.title}</p>
            {prompt.request.description ? (
              <p className="mb-3 text-[var(--muted-foreground)]">{prompt.request.description}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {(prompt.request.options ?? []).map((opt, index) => (
                <button
                  type="button"
                  key={opt.value}
                  className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-[var(--primary-foreground)]"
                  onClick={onButton(() =>
                    onAnswerAsk(prompt.id, { type: 'answer', values: [opt.value] }),
                  )}
                >
                  {dock && index < 9 && <span className="mr-1.5 opacity-60">{index + 1}</span>}
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                className="rounded-md bg-zinc-600 px-3 py-1.5 text-white"
                onClick={onButton(() => onAnswerAsk(prompt.id, { type: 'cancelled' }))}
              >
                Cancel
              </button>
            </div>
          </>
        )}
        {dock &&
          (armed ? (
            <p className="mt-3 text-[10px] text-[var(--muted-foreground)] opacity-70">
              {prompt.kind === 'permission' ? '1 allow · 2 deny' : '1–9 choose'} · Esc{' '}
              {prompt.kind === 'permission' ? 'deny' : 'cancel'}
            </p>
          ) : (
            <p className="mt-3 text-[10px] text-[var(--muted-foreground)] opacity-70">
              keys answer in a moment · click to answer now
            </p>
          ))}
      </div>
    </div>
  );
}
