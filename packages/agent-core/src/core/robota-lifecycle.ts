/**
 * Lifecycle and stats helpers for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 */
import type { TAgentStatsMetadata } from './robota-config-manager';
import type { TUniversalMessage } from '../interfaces/agent';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { ModuleRegistry } from '../managers/module-registry';
import type { Tools } from '../managers/tool-manager';
import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import type { ExecutionService } from '../services/execution-service';
import type { ILogger } from '../utils/logger';

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
  const currentProviderInfo = deps.isFullyInitialized
    ? deps.aiProviders.getCurrentProvider()
    : null;
  const currentProvider = currentProviderInfo ? currentProviderInfo.provider : null;
  const tools = deps.isFullyInitialized ? deps.tools.getTools().map((tool) => tool.name) : [];
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
      toolMessages: roleCounts.tool,
    },
    uptime,
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

/** Result of a best-effort destroy: cleanup failures are collected, never thrown (CORE-013). */
export interface IDestroyResult {
  errors: Error[];
}

/**
 * Destroy and clean up the agent instance — **best-effort** (CORE-013).
 *
 * Disposal must be safe to fire-and-forget (`void agent.destroy()`): a rejection here becomes an
 * unhandled rejection that kills the host process on Node 20+. Every cleanup step therefore runs
 * regardless of earlier failures; each failure is logged and collected into the returned
 * `IDestroyResult.errors` instead of being thrown. State is always reset.
 * @internal
 */
export async function destroyAgent(deps: IRobotaDestroyDeps): Promise<IDestroyResult> {
  deps.logger.debug('Destroying Robota instance', { name: deps.name });
  const errors: Error[] = [];

  const step = async (label: string, run: () => Promise<void> | void): Promise<void> => {
    try {
      await run();
      deps.logger.debug(label);
    } catch (error) {
      // allow-fallback: best-effort disposal IS the contract — failure is logged, collected into the returned result, and remaining steps still run (CORE-013)
      const wrapped = error instanceof Error ? error : new Error(String(error));
      errors.push(wrapped);
      deps.logger.error('Error during Robota destruction step', {
        step: label,
        error: wrapped.message,
      });
    }
  };

  if (deps.isFullyInitialized && deps.moduleRegistry) {
    await step('All modules disposed', () => deps.moduleRegistry.disposeAllModules());
  }

  if (deps.executionService) {
    const plugins = deps.executionService.getPlugins();
    for (const plugin of plugins) {
      // CORE-022 (SPEC § Disposal Chain Contract): dispose() is the SINGLE component-level
      // entry point — the base implementation unsubscribes module events, and overrides
      // release owned resources (timers/sockets/storage). Without this a plugin's resources
      // outlive the agent and keep the process event loop alive (RUNTIME-09).
      await step(`Plugin disposed: ${plugin.name}`, () => plugin.dispose());
    }
    deps.logger.debug('ExecutionService plugins cleaned up');
  }

  if (deps.moduleRegistry) {
    await step('ModuleRegistry cleared', () => deps.moduleRegistry.clearAllModules());
  }

  if (deps.eventEmitter) {
    await step('EventEmitter disposed', () => deps.eventEmitter.dispose());
  }

  deps.resetState();
  if (errors.length === 0) {
    deps.logger.info('Robota instance destroyed successfully', { name: deps.name });
  } else {
    deps.logger.warn('Robota instance destroyed with cleanup failures', {
      name: deps.name,
      failureCount: errors.length,
    });
  }
  return { errors };
}
