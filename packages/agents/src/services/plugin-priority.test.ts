import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionService } from './execution-service';
import { PluginPriority } from '../abstracts/abstract-plugin';
import type { IPluginContract, IPluginHooks } from '../abstracts/abstract-plugin';
import type { IPluginOptions, IPluginStats } from '../abstracts/abstract-plugin';

vi.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }),
    SilentLogger: class {
        info = vi.fn();
        debug = vi.fn();
        warn = vi.fn();
        error = vi.fn();
    }
}));

type TTestPlugin = IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks;

function createTestPlugin(name: string, priority: number, callLog: string[]): TTestPlugin {
    return {
        name,
        version: '1.0.0',
        enabled: true,
        category: 'custom' as const,
        priority,
        initialize: vi.fn(),
        beforeRun: vi.fn(async () => { callLog.push(name); }),
        afterRun: vi.fn(),
    } as unknown as TTestPlugin;
}

describe('Plugin priority-based execution order', () => {
    let service: ExecutionService;

    beforeEach(() => {
        const mockProviders = { getProvider: vi.fn(), getDefaultProvider: vi.fn() };
        const mockTools = { getTools: vi.fn().mockReturnValue([]), getTool: vi.fn() };
        const mockHistory = {
            addUserMessage: vi.fn(),
            addAssistantMessage: vi.fn(),
            addSystemMessage: vi.fn(),
            getMessages: vi.fn().mockReturnValue([]),
            getHistory: vi.fn().mockReturnValue([]),
            getStats: vi.fn().mockReturnValue({ totalMessages: 0, userMessages: 0, assistantMessages: 0, systemMessages: 0, totalTokens: 0 })
        };
        const mockEventService = {
            emit: vi.fn(),
            subscribe: vi.fn(),
            unsubscribe: vi.fn()
        };

        service = new ExecutionService(
            mockProviders as never,
            mockTools as never,
            mockHistory as never,
            mockEventService
        );
    });

    it('executes plugins in priority order (higher priority first)', async () => {
        const callLog: string[] = [];

        const lowPlugin = createTestPlugin('low-plugin', PluginPriority.LOW, callLog);
        const highPlugin = createTestPlugin('high-plugin', PluginPriority.HIGH, callLog);
        const normalPlugin = createTestPlugin('normal-plugin', PluginPriority.NORMAL, callLog);

        // Register in arbitrary order
        service.registerPlugin(lowPlugin);
        service.registerPlugin(highPlugin);
        service.registerPlugin(normalPlugin);

        // Verify internal order by checking plugin names
        const stats = await service.getStats();
        expect(stats.pluginNames).toEqual(['high-plugin', 'normal-plugin', 'low-plugin']);
    });

    it('preserves registration order for plugins with same priority', async () => {
        const callLog: string[] = [];

        const pluginA = createTestPlugin('plugin-a', PluginPriority.NORMAL, callLog);
        const pluginB = createTestPlugin('plugin-b', PluginPriority.NORMAL, callLog);
        const pluginC = createTestPlugin('plugin-c', PluginPriority.NORMAL, callLog);

        service.registerPlugin(pluginA);
        service.registerPlugin(pluginB);
        service.registerPlugin(pluginC);

        const stats = await service.getStats();
        expect(stats.pluginNames).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
    });

    it('handles CRITICAL priority before all others', async () => {
        const callLog: string[] = [];

        const normalPlugin = createTestPlugin('normal', PluginPriority.NORMAL, callLog);
        const criticalPlugin = createTestPlugin('critical', PluginPriority.CRITICAL, callLog);
        const minimalPlugin = createTestPlugin('minimal', PluginPriority.MINIMAL, callLog);

        service.registerPlugin(normalPlugin);
        service.registerPlugin(minimalPlugin);
        service.registerPlugin(criticalPlugin);

        const stats = await service.getStats();
        expect(stats.pluginNames).toEqual(['critical', 'normal', 'minimal']);
    });

    it('handles plugins with no explicit priority (defaults to 0)', async () => {
        const callLog: string[] = [];

        const withPriority = createTestPlugin('with-priority', PluginPriority.NORMAL, callLog);
        const noPriority = createTestPlugin('no-priority', 0, callLog);

        service.registerPlugin(noPriority);
        service.registerPlugin(withPriority);

        const stats = await service.getStats();
        expect(stats.pluginNames).toEqual(['with-priority', 'no-priority']);
    });

    it('maintains order across full priority spectrum', async () => {
        const callLog: string[] = [];

        const plugins = [
            createTestPlugin('minimal', PluginPriority.MINIMAL, callLog),
            createTestPlugin('low', PluginPriority.LOW, callLog),
            createTestPlugin('normal', PluginPriority.NORMAL, callLog),
            createTestPlugin('high', PluginPriority.HIGH, callLog),
            createTestPlugin('critical', PluginPriority.CRITICAL, callLog),
        ];

        // Register in reverse order
        for (const plugin of plugins) {
            service.registerPlugin(plugin);
        }

        const stats = await service.getStats();
        expect(stats.pluginNames).toEqual([
            'critical', 'high', 'normal', 'low', 'minimal'
        ]);
    });
});
