'use client';

import React from 'react';

import type { TPendingPrompt } from '../hooks/prompt-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';

/**
 * Renders the owner's pending permission/ask prompts (REMOTE-007/009). Under local == remote the paired
 * browser owner answers its OWN prompts; the first pending prompt is shown as a modal-style card. A gated tool
 * call blocks until answered, so this is on the critical path — not decorative.
 */
interface IPermissionPromptProps {
  prompts: readonly TPendingPrompt[];
  onAnswerPermission: (id: string, result: boolean) => void;
  onAnswerAsk: (id: string, response: TActionResponse) => void;
}

export function PermissionPrompt({
  prompts,
  onAnswerPermission,
  onAnswerAsk,
}: IPermissionPromptProps): React.ReactElement | null {
  const prompt = prompts[0];
  if (!prompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-[var(--card)] p-5 font-mono text-[13px] shadow-xl">
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
              {(prompt.request.options ?? []).map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-[var(--primary-foreground)]"
                  onClick={() => onAnswerAsk(prompt.id, { type: 'answer', values: [opt.value] })}
                >
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
      </div>
    </div>
  );
}
