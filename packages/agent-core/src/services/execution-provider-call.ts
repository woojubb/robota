/**
 * One provider call, honouring the run's cancellation signal and the configured idle timeout.
 *
 * Split out of `execution-round-provider.ts`, which had grown two responsibilities: ASSEMBLING a
 * request (what options, which transport, which tools this model may have) and MAKING one safely
 * (abort propagation, idle detection, listener cleanup). They change for different reasons.
 *
 * Exported so every provider call in the execution turn goes through one implementation — CORE-042:
 * the forced-summary call was the last one built by hand, and it silently had neither guard.
 */

import type { TUniversalMessage } from '../interfaces/messages';
import type { IChatOptions } from '../interfaces/provider';

type TProviderChat = (
  messages: TUniversalMessage[],
  options: IChatOptions,
) => Promise<TUniversalMessage>;

/**
 * Call a provider honouring the run's cancellation signal and the configured idle timeout.
 *
 * Exported so that every provider call in the execution turn goes through one implementation --
 * CORE-042: the forced-summary call was the last one built by hand, and it silently had neither.
 */
export async function callProviderWithIdleTimeout(
  chat: TProviderChat,
  messages: TUniversalMessage[],
  options: IChatOptions,
  timeoutMs: number | undefined,
): Promise<TUniversalMessage> {
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const upstreamSignal = options.signal;
  if (normalizedTimeoutMs === undefined && upstreamSignal === undefined) {
    return chat(messages, options);
  }
  if (upstreamSignal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let rejectGuard: ((reason: Error) => void) | undefined;

  const clearIdleTimer = (): void => {
    if (idleTimer !== undefined) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
  };

  const failWith = (error: Error): void => {
    if (settled) return;
    settled = true;
    rejectGuard?.(error);
    controller.abort(error);
  };

  const resetIdleTimer = (): void => {
    if (normalizedTimeoutMs === undefined || settled) return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      failWith(new Error(`Provider call idle timeout after ${normalizedTimeoutMs}ms`));
    }, normalizedTimeoutMs);
  };

  const handleUpstreamAbort = (): void => {
    failWith(createAbortError());
  };
  upstreamSignal?.addEventListener('abort', handleUpstreamAbort, { once: true });

  const originalOnTextDelta = options.onTextDelta;
  const guardedOptions: IChatOptions = {
    ...options,
    signal: controller.signal,
    ...(originalOnTextDelta !== undefined
      ? {
          onTextDelta: (delta: string): void => {
            resetIdleTimer();
            originalOnTextDelta(delta);
          },
        }
      : {}),
  };

  resetIdleTimer();

  try {
    return await Promise.race([
      chat(messages, guardedOptions),
      new Promise<never>((_, reject) => {
        rejectGuard = reject;
      }),
    ]);
  } finally {
    settled = true;
    clearIdleTimer();
    upstreamSignal?.removeEventListener('abort', handleUpstreamAbort);
  }
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  return timeoutMs;
}

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
