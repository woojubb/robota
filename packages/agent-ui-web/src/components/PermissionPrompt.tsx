'use client';

import React, { useEffect } from 'react';

import type { TPendingPrompt } from '../hooks/prompt-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';

/**
 * Renders the owner's pending permission/ask prompts (REMOTE-007/009). Under local == remote the paired
 * browser owner answers its OWN prompts; the first pending prompt is shown. A gated tool call blocks
 * until answered, so this is on the critical path — not decorative.
 *
 * `modal` covers the page; `dock` sits above the composer, as desktop agent apps place a pending
 * question next to where the answer is typed, and takes the keyboard: 1–9 picks an option, Esc
 * cancels a question or denies a permission.
 */
interface IPermissionPromptProps {
  prompts: readonly TPendingPrompt[];
  onAnswerPermission: (id: string, result: boolean) => void;
  onAnswerAsk: (id: string, response: TActionResponse) => void;
  layout?: 'modal' | 'dock';
}

export function PermissionPrompt({
  prompts,
  onAnswerPermission,
  onAnswerAsk,
  layout = 'modal',
}: IPermissionPromptProps): React.ReactElement | null {
  const prompt = prompts[0];
  useEffect(() => {
    if (!prompt || layout !== 'dock') return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (prompt.kind === 'permission') onAnswerPermission(prompt.id, false);
        else onAnswerAsk(prompt.id, { type: 'cancelled' });
        return;
      }
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || event.target instanceof HTMLTextAreaElement)
        return;
      if (prompt.kind === 'permission') {
        if (index < 2) onAnswerPermission(prompt.id, index === 0);
        return;
      }
      const option = prompt.request.options?.[index];
      if (option) onAnswerAsk(prompt.id, { type: 'answer', values: [option.value] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, layout, onAnswerPermission, onAnswerAsk]);
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
  return (
    <div
      className={
        dock
          ? 'gui-rise flex-shrink-0 px-3 pt-2'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
      }
    >
      <div
        role={dock ? 'dialog' : undefined}
        aria-label={dock ? 'pending question' : undefined}
        className={
          dock
            ? 'w-full rounded-xl border border-primary/30 bg-card p-4 font-mono text-[13px] shadow-lg shadow-black/30'
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
                onClick={() => onAnswerPermission(prompt.id, true)}
              >
                Allow
              </button>
              <button
                type="button"
                className="rounded-md bg-rose-600 px-3 py-1.5 text-white"
                onClick={() => onAnswerPermission(prompt.id, false)}
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
                  onClick={() => onAnswerAsk(prompt.id, { type: 'answer', values: [opt.value] })}
                >
                  {dock && index < 9 && <span className="mr-1.5 opacity-60">{index + 1}</span>}
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                className="rounded-md bg-zinc-600 px-3 py-1.5 text-white"
                onClick={() => onAnswerAsk(prompt.id, { type: 'cancelled' })}
              >
                Cancel
              </button>
            </div>
          </>
        )}
        {dock && (
          <p className="mt-3 text-[10px] text-[var(--muted-foreground)] opacity-70">
            {prompt.kind === 'permission' ? '1 allow · 2 deny' : '1–9 choose'} · Esc{' '}
            {prompt.kind === 'permission' ? 'deny' : 'cancel'}
          </p>
        )}
      </div>
    </div>
  );
}
