import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AbstractModule, ModuleCategory, ModuleLayer } from './abstract-module';
import type {
  IModuleCapabilities,
  IModuleDescriptor,
  IModuleExecutionContext,
  IModuleExecutionResult,
} from './abstract-module';

class TestModule extends AbstractModule {
  readonly name = 'test-module';
  readonly version = '1.0.0';
  executeCalled = false;
  disposeCalled = false;
  shouldThrowOnExecute = false;
  shouldThrowOnDispose = false;

  getModuleType(): IModuleDescriptor {
    return { type: 'test', category: ModuleCategory.CORE, layer: ModuleLayer.APPLICATION };
  }

  getCapabilities(): IModuleCapabilities {
    return { capabilities: ['test-cap'] };
  }

  protected override async onExecute(
    context: IModuleExecutionContext,
  ): Promise<IModuleExecutionResult> {
    if (this.shouldThrowOnExecute) throw new Error('execution error');
    this.executeCalled = true;
    return { success: true, data: { result: 'done' } };
  }

  protected override async onDispose(): Promise<void> {
    if (this.shouldThrowOnDispose) throw new Error('dispose error');
    this.disposeCalled = true;
  }
}

describe('AbstractModule', () => {
  let module: TestModule;

  beforeEach(() => {
    module = new TestModule();
  });

  describe('initialize', () => {
    it('initializes the module', async () => {
      await module.initialize();
      expect(module.isInitialized()).toBe(true);
    });

    it('sets enabled from options', async () => {
      await module.initialize({ enabled: false });
      expect(module.isEnabled()).toBe(false);
    });

    it('emits events when eventEmitter is provided', async () => {
      const emitter = { emit: vi.fn() };
      await module.initialize({}, emitter as any);
      expect(emitter.emit).toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('executes successfully when initialized and enabled', async () => {
      await module.initialize();
      const result = await module.execute({ executionId: 'e1' });
      expect(result.success).toBe(true);
      expect(module.executeCalled).toBe(true);
    });

    it('throws when not enabled', async () => {
      await module.initialize();
      module.disable();
      await expect(module.execute({})).rejects.toThrow('is disabled');
    });

    it('throws when not initialized', async () => {
      await expect(module.execute({})).rejects.toThrow('is not initialized');
    });

    it('tracks execution stats on success', async () => {
      await module.initialize();
      await module.execute({});
      const stats = module.getStats();
      expect(stats.executionCount).toBe(1);
      expect(stats.errorCount).toBe(0);
    });

    it('tracks error stats on failure', async () => {
      await module.initialize();
      module.shouldThrowOnExecute = true;
      await expect(module.execute({})).rejects.toThrow('execution error');
      const stats = module.getStats();
      expect(stats.errorCount).toBe(1);
    });

    it('emits execution events with eventEmitter', async () => {
      const emitter = { emit: vi.fn() };
      await module.initialize({}, emitter as any);
      emitter.emit.mockClear();
      await module.execute({
        executionId: 'e1',
        sessionId: 's1',
        userId: 'u1',
        agentName: 'agent',
      });
      expect(emitter.emit).toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('disposes the module', async () => {
      await module.initialize();
      await module.dispose();
      expect(module.isInitialized()).toBe(false);
      expect(module.isEnabled()).toBe(false);
      expect(module.disposeCalled).toBe(true);
    });

    it('emits dispose events with eventEmitter', async () => {
      const emitter = { emit: vi.fn() };
      await module.initialize({}, emitter as any);
      emitter.emit.mockClear();
      await module.dispose();
      expect(emitter.emit).toHaveBeenCalled();
    });

    it('emits error event on dispose failure', async () => {
      const emitter = { emit: vi.fn() };
      await module.initialize({}, emitter as any);
      module.shouldThrowOnDispose = true;
      await expect(module.dispose()).rejects.toThrow('dispose error');
    });
  });

  describe('enable/disable', () => {
    it('enable sets enabled to true', () => {
      module.disable();
      module.enable();
      expect(module.isEnabled()).toBe(true);
    });

    it('disable sets enabled to false', () => {
      module.disable();
      expect(module.isEnabled()).toBe(false);
    });
  });

  describe('getData', () => {
    it('returns module data', () => {
      const data = module.getData();
      expect(data.name).toBe('test-module');
      expect(data.version).toBe('1.0.0');
      expect(data.type).toBe('test');
      expect(data.capabilities.capabilities).toContain('test-cap');
    });
  });

  describe('getStatus', () => {
    it('returns module status', () => {
      const status = module.getStatus();
      expect(status.name).toBe('test-module');
      expect(status.initialized).toBe(false);
      expect(status.hasEventEmitter).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns stats with averageExecutionTime after execution', async () => {
      await module.initialize();
      await module.execute({});
      const stats = module.getStats();
      expect(stats.executionCount).toBe(1);
      expect(stats.averageExecutionTime).toBeDefined();
    });
  });
});
