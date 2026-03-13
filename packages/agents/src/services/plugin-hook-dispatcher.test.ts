import { describe, it, expect, vi } from 'vitest';
import { callPluginHook, type TPluginWithHooks } from './plugin-hook-dispatcher';
import type { ILogger } from '../utils/logger';

function createMockLogger(): ILogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn()
    };
}

function createMockPlugin(overrides: Partial<TPluginWithHooks> = {}): TPluginWithHooks {
    return {
        name: 'test-plugin',
        version: '1.0.0',
        category: 'monitoring' as any,
        priority: 0 as any,
        getStatus: vi.fn().mockReturnValue({ name: 'test-plugin', enabled: true, initialized: true }),
        initialize: vi.fn(),
        dispose: vi.fn(),
        beforeRun: vi.fn(),
        afterRun: vi.fn(),
        onError: vi.fn(),
        beforeProviderCall: vi.fn(),
        afterProviderCall: vi.fn(),
        ...overrides
    } as any;
}

describe('callPluginHook', () => {
    const logger = createMockLogger();

    it('calls beforeRun on plugins with input', async () => {
        const plugin = createMockPlugin();
        await callPluginHook([plugin], 'beforeRun', { input: 'hello' }, logger);
        expect(plugin.beforeRun).toHaveBeenCalledWith('hello', undefined);
    });

    it('calls afterRun on plugins with input and response', async () => {
        const plugin = createMockPlugin();
        await callPluginHook([plugin], 'afterRun', { input: 'hello', response: 'world' }, logger);
        expect(plugin.afterRun).toHaveBeenCalledWith('hello', 'world', undefined);
    });

    it('calls beforeProviderCall with messages', async () => {
        const plugin = createMockPlugin();
        const messages = [{ role: 'user' as const, content: 'test', timestamp: new Date() }];
        await callPluginHook([plugin], 'beforeProviderCall', { messages }, logger);
        expect(plugin.beforeProviderCall).toHaveBeenCalledWith(messages);
    });

    it('calls afterProviderCall with messages and responseMessage', async () => {
        const plugin = createMockPlugin();
        const messages = [{ role: 'user' as const, content: 'test', timestamp: new Date() }];
        const responseMessage = { role: 'assistant' as const, content: 'reply', timestamp: new Date() };
        await callPluginHook([plugin], 'afterProviderCall', { messages, responseMessage }, logger);
        expect(plugin.afterProviderCall).toHaveBeenCalledWith(messages, responseMessage);
    });

    it('calls onError with error', async () => {
        const plugin = createMockPlugin();
        const error = new Error('test error');
        await callPluginHook([plugin], 'onError', { error }, logger);
        expect(plugin.onError).toHaveBeenCalled();
    });

    it('skips unknown hook names without error', async () => {
        const plugin = createMockPlugin();
        await expect(
            callPluginHook([plugin], 'unknownHook', {}, logger)
        ).resolves.toBeUndefined();
    });

    it('continues executing remaining plugins when one throws', async () => {
        const failPlugin = createMockPlugin({
            beforeRun: vi.fn().mockRejectedValue(new Error('fail'))
        });
        const successPlugin = createMockPlugin();
        await callPluginHook([failPlugin, successPlugin], 'beforeRun', { input: 'test' }, logger);
        expect(successPlugin.beforeRun).toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('does not call beforeRun when input is missing', async () => {
        const plugin = createMockPlugin();
        await callPluginHook([plugin], 'beforeRun', {}, logger);
        expect(plugin.beforeRun).not.toHaveBeenCalled();
    });

    it('calls onError with execution context fields', async () => {
        const plugin = createMockPlugin();
        const error = new Error('err');
        await callPluginHook([plugin], 'onError', {
            error,
            executionContext: { executionId: 'exec-1', sessionId: 'sess-1', userId: 'user-1' }
        }, logger);
        expect(plugin.onError).toHaveBeenCalled();
        const callArgs = (plugin.onError as any).mock.calls[0];
        expect(callArgs[0]).toBe(error);
        expect(callArgs[1].executionId).toBe('exec-1');
        expect(callArgs[1].sessionId).toBe('sess-1');
        expect(callArgs[1].userId).toBe('user-1');
    });
});
