/**
 * Lifecycle and stats helpers for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import type { TUniversalMessage } from '../interfaces/agent';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { Tools } from '../managers/tool-manager';
import type { ModuleRegistry } from '../managers/module-registry';
import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import type { ExecutionService } from '../services/execution-service';
import type { ILogger } from '../utils/logger';
import type { TAgentStatsMetadata } from './robota-config-manager';

/** Dependencies required by getStats. @internal */
export interface IRobotaStatsDeps {
    readonly name: string;
    readonly version: string;
    readonly conversationId: string;
    readonly startTime: number;
    readonly isFullyInitialized: boolean;
    aiProviders: AIProviders;
    tools: Tools;
    getPluginNames(): string[];
    getModuleNames(): string[];
    getHistory(): TUniversalMessage[];
}

/** Build comprehensive agent statistics. @internal */
export function buildAgentStats(deps: IRobotaStatsDeps): {
    name: string;
    version: string;
    conversationId: string;
    providers: string[];
    currentProvider: string | null;
    tools: string[];
    plugins: string[];
    modules: string[];
    historyLength: number;
    historyStats: TAgentStatsMetadata;
    uptime: number;
} {
    const providers = deps.isFullyInitialized ? deps.aiProviders.getProviderNames() : [];
    const currentProviderInfo = deps.isFullyInitialized ? deps.aiProviders.getCurrentProvider() : null;
    const currentProvider = currentProviderInfo ? currentProviderInfo.provider : null;
    const tools = deps.isFullyInitialized ? deps.tools.getTools().map(tool => tool.name) : [];
    const plugins = deps.getPluginNames();
    const modules = deps.getModuleNames();
    const history = deps.getHistory();
    const uptime = Date.now() - deps.startTime;

    const roleCounts = { user: 0, assistant: 0, system: 0, tool: 0 };
    for (const msg of history) {
        if (msg.role in roleCounts) {
            roleCounts[msg.role as keyof typeof roleCounts]++;
        }
    }

    return {
        name: deps.name,
        version: deps.version,
        conversationId: deps.conversationId,
        providers,
        currentProvider,
        tools,
        plugins,
        modules,
        historyLength: history.length,
        historyStats: {
            userMessages: roleCounts.user,
            assistantMessages: roleCounts.assistant,
            systemMessages: roleCounts.system,
            toolMessages: roleCounts.tool
        },
        uptime
    };
}

/** Dependencies required by destroy. @internal */
export interface IRobotaDestroyDeps {
    readonly name: string;
    readonly isFullyInitialized: boolean;
    moduleRegistry: ModuleRegistry;
    eventEmitter: EventEmitterPlugin;
    executionService: ExecutionService | undefined;
    logger: ILogger;
    resetState(): void;
}

/** Destroy and clean up the agent instance. @internal */
export async function destroyAgent(deps: IRobotaDestroyDeps): Promise<void> {
    deps.logger.debug('Destroying Robota instance', { name: deps.name });

    try {
        if (deps.isFullyInitialized && deps.moduleRegistry) {
            await deps.moduleRegistry.disposeAllModules();
            deps.logger.debug('All modules disposed');
        }

        if (deps.executionService) {
            const plugins = deps.executionService.getPlugins();
            for (const plugin of plugins) {
                if (plugin.unsubscribeFromModuleEvents && deps.eventEmitter) {
                    await plugin.unsubscribeFromModuleEvents(deps.eventEmitter);
                }
            }
            deps.logger.debug('ExecutionService plugins cleaned up');
        }

        if (deps.moduleRegistry) {
            deps.moduleRegistry.clearAllModules();
            deps.logger.debug('ModuleRegistry cleared');
        }

        if (deps.eventEmitter) {
            await deps.eventEmitter.destroy();
            deps.logger.debug('EventEmitter disposed');
        }

        deps.resetState();
        deps.logger.info('Robota instance destroyed successfully', { name: deps.name });

    } catch (error) {
        deps.logger.error('Error during Robota destruction', {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}
