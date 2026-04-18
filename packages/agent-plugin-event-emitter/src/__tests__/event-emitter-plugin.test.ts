import { describe, expect, it, vi } from 'vitest';
import { EventEmitterPlugin } from '../event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../types';

describe('EventEmitterPlugin', () => {
  it('once listener should be called exactly once', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const listener = vi.fn();
    plugin.once(EVENT_EMITTER_EVENTS.CUSTOM, listener);

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('off should remove listener by id and by function', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const first = vi.fn();
    const second = vi.fn();
    const id = plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, first);
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, second);

    expect(plugin.off(EVENT_EMITTER_EVENTS.CUSTOM, id)).toBe(true);
    expect(plugin.off(EVENT_EMITTER_EVENTS.CUSTOM, second)).toBe(true);

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    expect(first).toHaveBeenCalledTimes(0);
    expect(second).toHaveBeenCalledTimes(0);
  });

  it('filter should control listener invocation', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener, {
      filter: (event) => event.executionId === 'ok',
    });

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM, { executionId: 'skip' });
    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM, { executionId: 'ok' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should throw when maxListeners is exceeded', () => {
    const plugin = new EventEmitterPlugin({
      maxListeners: 1,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => undefined);

    expect(() => plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => undefined)).toThrow(
      'Maximum listeners',
    );
  });

  it('buffering should defer handling until flush', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
      buffer: { enabled: true, maxSize: 100, flushInterval: 1000 },
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    expect(listener).toHaveBeenCalledTimes(0);

    await plugin.flushBuffer();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('handler throw should propagate and must not re-emit plugin.error', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      catchErrors: true,
      events: [EVENT_EMITTER_EVENTS.CUSTOM, EVENT_EMITTER_EVENTS.PLUGIN_ERROR],
    });
    const pluginErrorListener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.PLUGIN_ERROR, pluginErrorListener);
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => {
      throw new Error('boom');
    });

    await expect(plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM)).rejects.toThrow('boom');
    expect(pluginErrorListener).toHaveBeenCalledTimes(0);
  });

  it('getStats should report totalEmitted and totalErrors', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      catchErrors: true,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => {
      throw new Error('stats-error');
    });

    await expect(plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM)).rejects.toThrow('stats-error');
    const stats = plugin.getStats();
    expect(stats.totalEmitted).toBe(1);
    expect(stats.totalErrors).toBe(1);
  });

  it('async mode should run handlers concurrently', async () => {
    const plugin = new EventEmitterPlugin({
      async: true,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const order: number[] = [];
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, async () => {
      order.push(1);
    });
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, async () => {
      order.push(2);
    });

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    expect(order).toHaveLength(2);
  });

  it('off should return false for non-existent event type', () => {
    const plugin = new EventEmitterPlugin({
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    expect(plugin.off(EVENT_EMITTER_EVENTS.CUSTOM, 'no-such-id')).toBe(false);
  });

  it('off should return false for listener not found', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);
    const other = vi.fn();
    expect(plugin.off(EVENT_EMITTER_EVENTS.CUSTOM, other)).toBe(false);
  });

  it('emit should be a no-op for unregistered event type', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);
    await plugin.emit(EVENT_EMITTER_EVENTS.AGENT_EXECUTION_START);
    expect(listener).not.toHaveBeenCalled();
  });

  it('global filter should suppress matching events', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
      filters: {
        [EVENT_EMITTER_EVENTS.CUSTOM]: (event) => event.executionId === 'allowed',
      },
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM, { executionId: 'blocked' });
    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM, { executionId: 'allowed' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('buffer auto-flushes when maxSize is reached', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
      buffer: { enabled: true, maxSize: 2, flushInterval: 10000 },
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    expect(listener).toHaveBeenCalledTimes(0);
    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    // flushBuffer called fire-and-forget; wait for all async chains to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(plugin.getStats().bufferedEvents).toBe(0);
  });

  it('clearAllListeners should remove all handlers', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);
    plugin.clearAllListeners();

    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);
    expect(listener).not.toHaveBeenCalled();
  });

  it('getStats should report listener counts and buffered events', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
      buffer: { enabled: true, maxSize: 100, flushInterval: 10000 },
    });
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, vi.fn());
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, vi.fn());
    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);

    const stats = plugin.getStats();
    expect(stats.totalListeners).toBe(2);
    expect(stats.bufferedEvents).toBe(1);
    expect(stats.eventTypes).toContain(EVENT_EMITTER_EVENTS.CUSTOM);
  });

  it('destroy should flush buffer and clear listeners', async () => {
    const plugin = new EventEmitterPlugin({
      async: false,
      events: [EVENT_EMITTER_EVENTS.CUSTOM],
      buffer: { enabled: true, maxSize: 100, flushInterval: 10000 },
    });
    const listener = vi.fn();
    plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener);
    await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM);

    await plugin.destroy();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
