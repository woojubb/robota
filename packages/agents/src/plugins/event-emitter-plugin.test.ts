import { describe, expect, it, vi } from 'vitest';
import { EventEmitterPlugin } from './event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from './event-emitter/types';

describe('EventEmitterPlugin', () => {
    it('once listener should be called exactly once', async () => {
        const plugin = new EventEmitterPlugin({
            async: false,
            events: [EVENT_EMITTER_EVENTS.CUSTOM]
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
            events: [EVENT_EMITTER_EVENTS.CUSTOM]
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
            events: [EVENT_EMITTER_EVENTS.CUSTOM]
        });
        const listener = vi.fn();
        plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, listener, {
            filter: event => event.executionId === 'ok'
        });

        await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM, { executionId: 'skip' });
        await plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM, { executionId: 'ok' });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should throw when maxListeners is exceeded', () => {
        const plugin = new EventEmitterPlugin({
            maxListeners: 1,
            events: [EVENT_EMITTER_EVENTS.CUSTOM]
        });
        plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => undefined);

        expect(() => plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => undefined)).toThrow('Maximum listeners');
    });

    it('buffering should defer handling until flush', async () => {
        const plugin = new EventEmitterPlugin({
            async: false,
            events: [EVENT_EMITTER_EVENTS.CUSTOM],
            buffer: { enabled: true, maxSize: 100, flushInterval: 1000 }
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
            events: [EVENT_EMITTER_EVENTS.CUSTOM, EVENT_EMITTER_EVENTS.PLUGIN_ERROR]
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
            events: [EVENT_EMITTER_EVENTS.CUSTOM]
        });
        plugin.on(EVENT_EMITTER_EVENTS.CUSTOM, () => {
            throw new Error('stats-error');
        });

        await expect(plugin.emit(EVENT_EMITTER_EVENTS.CUSTOM)).rejects.toThrow('stats-error');
        const stats = plugin.getStats();
        expect(stats.totalEmitted).toBe(1);
        expect(stats.totalErrors).toBe(1);
    });
});
