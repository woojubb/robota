import { describe, expect, it } from 'vitest';
import { AbstractManager } from './abstract-manager';

function barrier() {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

class ControlledManager extends AbstractManager {
  initializeCalls = 0;
  disposeCalls = 0;
  constructor(
    private readonly setup: () => Promise<void> = async () => {},
    private readonly cleanup: () => Promise<void> = async () => {},
    ready = false,
  ) {
    super({ readyOnConstruction: ready });
  }
  protected async doInitialize() {
    this.initializeCalls++;
    await this.setup();
  }
  protected async doDispose() {
    this.disposeCalls++;
    await this.cleanup();
  }
  read() {
    this.ensureInitialized();
    return 'ready';
  }
}

describe('manager lifecycle barriers', () => {
  it('coalesces concurrent initialization of the same manager', async () => {
    const pending = barrier();
    const started = barrier();
    const manager = new ControlledManager(async () => {
      started.release();
      await pending.promise;
    });
    const first = manager.initialize();
    const second = manager.initialize();
    await started.promise;
    try {
      expect(manager.initializeCalls).toBe(1);
    } finally {
      pending.release();
      await Promise.all([first, second]);
    }
    expect(manager.read()).toBe('ready');
    await manager.dispose();
  });

  it('waits for full disposal before reinitializing and refuses use immediately', async () => {
    const pending = barrier();
    const started = barrier();
    const manager = new ControlledManager(
      undefined,
      async () => {
        started.release();
        await pending.promise;
      },
      true,
    );
    const disposal = manager.dispose();
    let reinitialized = false;
    const initialization = manager.initialize().then(() => {
      reinitialized = true;
    });
    await started.promise;
    try {
      expect(reinitialized).toBe(false);
      expect(manager.isInitialized()).toBe(false);
      expect(() => manager.read()).toThrow();
    } finally {
      pending.release();
      await Promise.all([disposal, initialization]);
    }
    expect(manager.read()).toBe('ready');
    expect(manager.initializeCalls).toBe(1);
    await manager.dispose();
  });

  it('runs one cleanup for concurrent disposal calls and permits a later lifecycle', async () => {
    const pending = barrier();
    const started = barrier();
    const manager = new ControlledManager(
      undefined,
      async () => {
        started.release();
        await pending.promise;
      },
      true,
    );
    const first = manager.dispose();
    const second = manager.dispose();
    await started.promise;
    try {
      expect(manager.disposeCalls).toBe(1);
    } finally {
      pending.release();
      await Promise.all([first, second]);
    }
    await manager.initialize();
    expect(manager.read()).toBe('ready');
    await manager.dispose();
  });

  it('clears failed lifecycle promises so initialization and disposal can be retried', async () => {
    let setupCalls = 0;
    let cleanupCalls = 0;
    const manager = new ControlledManager(
      async () => {
        if (++setupCalls === 1) throw new Error('setup failed');
      },
      async () => {
        if (++cleanupCalls === 1) throw new Error('cleanup failed');
      },
    );
    await expect(manager.initialize()).rejects.toThrow('setup failed');
    await manager.initialize();
    expect(manager.read()).toBe('ready');
    await expect(manager.dispose()).rejects.toThrow('cleanup failed');
    expect(manager.isInitialized()).toBe(false);
    await manager.initialize();
    expect(manager.read()).toBe('ready');
    await manager.dispose();
    expect(manager.initializeCalls).toBe(3);
    expect(manager.disposeCalls).toBe(2);
  });

  it('drains an in-progress initialization before cleanup and never publishes late readiness', async () => {
    const pending = barrier();
    const started = barrier();
    const events: string[] = [];
    const manager = new ControlledManager(
      async () => {
        started.release();
        await pending.promise;
        events.push('initialized');
      },
      async () => {
        events.push('disposed');
      },
    );
    const initialization = manager.initialize();
    const disposal = manager.dispose();
    await started.promise;
    try {
      expect(manager.disposeCalls).toBe(0);
    } finally {
      pending.release();
      await Promise.all([initialization, disposal]);
    }
    expect(events).toEqual(['initialized', 'disposed']);
    expect(manager.isInitialized()).toBe(false);
    expect(() => manager.read()).toThrow();
  });
});
