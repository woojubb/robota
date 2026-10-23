import { describe, expect, it, vi } from 'vitest';
import { AIProviders } from './ai-provider-manager';
import { createScriptedProvider } from '../testing/scripted-provider';

function client() {
  return Object.assign(createScriptedProvider([{ text: 'ready' }]).provider, {
    close: vi.fn(async () => {}),
  });
}

describe('provider registration retirement', () => {
  it('never closes borrowed registrations when removed, replaced or disposed', async () => {
    const manager = new AIProviders();
    const first = client();
    const second = client();
    manager.addProvider('shared', first, { ownership: 'borrowed' });
    manager.addProvider('shared', second, { ownership: 'borrowed' });
    manager.removeProvider('shared');
    await manager.dispose();
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  it('awaits removal and replacement retirement across concurrent disposal without closing twice', async () => {
    const manager = new AIProviders();
    let finishClose: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const previous = Object.assign(client(), { close: vi.fn(() => pending) });
    const replacement = client();
    manager.addProvider('shared', previous);
    manager.addProvider('shared', replacement);
    manager.removeProvider('shared');
    let settled = false;
    const disposal = Promise.all([manager.dispose(), manager.dispose()]).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(previous.close).toHaveBeenCalledOnce();
    expect(replacement.close).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    expect(() => manager.addProvider('late', client())).toThrow();
    finishClose();
    await disposal;
    await manager.dispose();
    expect(previous.close).toHaveBeenCalledOnce();
    expect(replacement.close).toHaveBeenCalledOnce();
  });

  it('keeps the same instance alive during in-place registration and honors the new ownership', async () => {
    const manager = new AIProviders();
    const provider = client();
    manager.addProvider('same', provider);
    manager.addProvider('same', provider, { ownership: 'borrowed' });
    await manager.dispose();
    expect(provider.close).not.toHaveBeenCalled();
  });

  it('observes synchronous close failures and asynchronous failures while finishing other cleanup', async () => {
    const manager = new AIProviders();
    const syncFailure = Object.assign(client(), {
      close: vi.fn(() => {
        throw new Error('sync close');
      }),
    });
    const asyncFailure = Object.assign(client(), {
      close: vi.fn(async () => {
        throw new Error('async close');
      }),
    });
    const healthy = client();
    manager.addProvider('sync', syncFailure);
    manager.addProvider('async', asyncFailure);
    manager.addProvider('healthy', healthy);
    expect(() => manager.removeProvider('sync')).not.toThrow();
    await expect(manager.dispose()).resolves.toBeUndefined();
    expect(syncFailure.close).toHaveBeenCalledOnce();
    expect(asyncFailure.close).toHaveBeenCalledOnce();
    expect(healthy.close).toHaveBeenCalledOnce();
  });

  it('allows explicit reinitialization to own a new registration lifecycle', async () => {
    const manager = new AIProviders();
    const provider = client();
    manager.addProvider('provider', provider);
    await manager.dispose();
    await manager.initialize();
    manager.addProvider('provider', provider);
    await manager.dispose();
    expect(provider.close).toHaveBeenCalledTimes(2);
  });
});
