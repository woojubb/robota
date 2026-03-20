import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionProxy, createExecutionProxy, withEventEmission } from './execution-proxy';
import type { IEventService, IBaseEventData } from '../interfaces/event-service';

function createMockEventService(): IEventService {
  return {
    emit: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  } as any;
}

describe('ExecutionProxy', () => {
  let eventService: IEventService;

  beforeEach(() => {
    eventService = createMockEventService();
  });

  describe('configureMethod', () => {
    it('returns this for chaining', () => {
      const proxy = new ExecutionProxy({
        eventService,
        sourceType: 'agent',
        sourceId: 'test',
      });
      const result = proxy.configureMethod('run', {
        startEvent: 'start',
        completeEvent: 'complete',
      });
      expect(result).toBe(proxy);
    });
  });

  describe('configureStandardMethods', () => {
    it('configures agent methods', () => {
      const proxy = new ExecutionProxy({
        eventService,
        sourceType: 'agent',
        sourceId: 'test',
      });
      const result = proxy.configureStandardMethods();
      expect(result).toBe(proxy);
    });

    it('configures team methods', () => {
      const proxy = new ExecutionProxy({
        eventService,
        sourceType: 'team',
        sourceId: 'test',
      });
      const result = proxy.configureStandardMethods();
      expect(result).toBe(proxy);
    });

    it('configures tool methods', () => {
      const proxy = new ExecutionProxy({
        eventService,
        sourceType: 'tool',
        sourceId: 'test',
      });
      const result = proxy.configureStandardMethods();
      expect(result).toBe(proxy);
    });
  });

  describe('wrap', () => {
    it('wraps target and emits start/complete events', async () => {
      const target = {
        async myMethod(arg: string) {
          return `result-${arg}`;
        },
      };
      const proxy = new ExecutionProxy<typeof target>({
        eventService,
        sourceType: 'agent',
        sourceId: 'test-agent',
      });
      proxy.configureMethod('myMethod', {
        startEvent: 'method.start',
        completeEvent: 'method.complete',
      });
      const wrapped = proxy.wrap(target);
      const result = await wrapped.myMethod('hello');
      expect(result).toBe('result-hello');
      expect(eventService.emit).toHaveBeenCalledTimes(2);
      const startCall = (eventService.emit as any).mock.calls[0];
      expect(startCall[0]).toBe('method.start');
      const completeCall = (eventService.emit as any).mock.calls[1];
      expect(completeCall[0]).toBe('method.complete');
    });

    it('emits error event on method failure', async () => {
      const target = {
        async myMethod() {
          throw new Error('boom');
        },
      };
      const proxy = new ExecutionProxy<typeof target>({
        eventService,
        sourceType: 'agent',
        sourceId: 'test-agent',
      });
      proxy.configureMethod('myMethod', {
        startEvent: 'method.start',
        errorEvent: 'method.error',
      });
      const wrapped = proxy.wrap(target);
      await expect(wrapped.myMethod()).rejects.toThrow('boom');
      const errorCall = (eventService.emit as any).mock.calls.find(
        (call: any[]) => call[0] === 'method.error',
      );
      expect(errorCall).toBeDefined();
    });

    it('does not wrap unconfigured methods', () => {
      const target = {
        normalMethod() {
          return 42;
        },
      };
      const proxy = new ExecutionProxy<typeof target>({
        eventService,
        sourceType: 'agent',
        sourceId: 'test',
      });
      const wrapped = proxy.wrap(target);
      expect(wrapped.normalMethod()).toBe(42);
      expect(eventService.emit).not.toHaveBeenCalled();
    });

    it('passes through non-string properties', () => {
      const sym = Symbol('test');
      const target = { [sym]: 'symval', normal: 'normalval' };
      const proxy = new ExecutionProxy<typeof target>({
        eventService,
        sourceType: 'agent',
        sourceId: 'test',
      });
      const wrapped = proxy.wrap(target);
      expect(wrapped[sym]).toBe('symval');
    });

    it('uses extractMetadata and extractResult when configured', async () => {
      const target = {
        async compute(x: number) {
          return { value: x * 2 };
        },
      };
      const proxy = new ExecutionProxy<typeof target>({
        eventService,
        sourceType: 'agent',
        sourceId: 'test',
      });
      proxy.configureMethod('compute', {
        startEvent: 'compute.start',
        completeEvent: 'compute.complete',
        extractMetadata: (_target, _method, args) => ({ input: args[0] }),
        extractResult: (result) => ({ output: (result as any).value }),
      });
      const wrapped = proxy.wrap(target);
      await wrapped.compute(5);
      expect(eventService.emit).toHaveBeenCalledTimes(2);
    });
  });
});

describe('createExecutionProxy', () => {
  it('creates a proxy with standard methods', async () => {
    const eventService = createMockEventService();
    const target = {
      async run(input: string) {
        return `response: ${input}`;
      },
    };
    const wrapped = createExecutionProxy(target, {
      eventService,
      sourceType: 'agent',
      sourceId: 'agent-1',
    });
    const result = await wrapped.run('test');
    expect(result).toBe('response: test');
    // Agent 'run' method is configured by configureStandardMethods
    expect(eventService.emit).toHaveBeenCalled();
  });
});

describe('withEventEmission', () => {
  it('wraps a target with event emission', () => {
    const eventService = createMockEventService();
    const target = { value: 42 };
    const wrapped = withEventEmission(eventService, 'agent', 'a1')(target);
    expect(wrapped.value).toBe(42);
  });
});
