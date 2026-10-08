import { expect, it, vi } from 'vitest';
import { SessionPromptRegistry } from '../session-prompt-registry.js';

it('withdraws a host-owned ask on abort and dismisses it on every surface', async () => {
  const emitAskRequest = vi.fn();
  const emitPromptResolved = vi.fn();
  const registry = new SessionPromptRegistry({
    emitAskRequest,
    emitPromptResolved,
    emitPermissionRequest: vi.fn(),
    countListeners: () => 1,
  });
  const controller = new AbortController();
  const response = registry.requestAsk(
    { id: 'auth-wait', title: 'Waiting for browser approval' },
    { signal: controller.signal },
  );
  const id = emitAskRequest.mock.calls[0]?.[0].id as string;
  try {
    controller.abort();
    expect(registry.pendingCount).toBe(0);
    await expect(response).resolves.toEqual({ type: 'cancelled' });
    expect(emitPromptResolved).toHaveBeenCalledWith({ id });
    registry.resolveAsk(id, { type: 'answer', values: ['late'] });
    expect(emitPromptResolved).toHaveBeenCalledTimes(1);
  } finally {
    registry.drain();
  }
});

it('does not emit an already aborted ask', async () => {
  const emitAskRequest = vi.fn();
  const registry = new SessionPromptRegistry({
    emitAskRequest,
    emitPromptResolved: vi.fn(),
    emitPermissionRequest: vi.fn(),
    countListeners: () => 1,
  });
  const controller = new AbortController();
  controller.abort();
  const response = registry.requestAsk(
    { id: 'auth-wait', title: 'Waiting for browser approval' },
    { signal: controller.signal },
  );
  try {
    expect(emitAskRequest).not.toHaveBeenCalled();
    await expect(response).resolves.toEqual({ type: 'cancelled' });
  } finally {
    registry.drain();
  }
});
