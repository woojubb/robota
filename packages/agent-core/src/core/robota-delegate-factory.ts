/**
 * Factory functions for creating the Robota delegate managers.
 *
 * Extracted from core/robota.ts to keep that file under 300 lines.
 * Creates RobotaModuleManager, RobotaPluginManager, and RobotaConfigManager
 * with all required closures bound to the Robota instance state.
 */
import type { ILogger } from '../utils/logger';
import type { IAgentConfig } from '../interfaces/agent';
import type { IAgentEventData } from '../interfaces/event-service';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { Tools } from '../managers/tool-manager';
import type { IEventService } from '../interfaces/event-service';
import type { ExecutionService } from '../services/execution-service';
import { ModuleRegistry } from '../managers/module-registry';
import { RobotaModuleManager } from './robota-module-manager';
import { RobotaPluginManager } from './robota-plugin-manager';
import { RobotaConfigManager } from './robota-config-manager';

/**
 * Mutable state references for the Robota instance.
 * All fields are accessed via getters/setters to allow live binding.
 */
export interface IRobotaDelegateState {
  getName: () => string;
  getModuleRegistry: () => ModuleRegistry;
  getLogger: () => ILogger;
  getIsFullyInitialized: () => boolean;
  ensureFullyInitialized: () => Promise<void>;
  getExecutionService: () => ExecutionService;
  getAiProviders: () => AIProviders;
  getTools: () => Tools;
  getEventService: () => IEventService;
  getConfig: () => IAgentConfig;
  setConfig: (c: IAgentConfig) => void;
  getConfigVersion: () => number;
  incrementConfigVersion: () => number;
  getConfigUpdatedAt: () => number;
  setConfigUpdatedAt: (t: number) => void;
  emitAgentEvent: (eventType: string, data: Record<string, unknown>) => void;
}

/**
 * Create all three delegate managers for a Robota instance.
 */
export function createRobotaDelegates(state: IRobotaDelegateState): {
  moduleManager: RobotaModuleManager;
  pluginManager: RobotaPluginManager;
  configManager: RobotaConfigManager;
} {
  const moduleManager = new RobotaModuleManager(
    state.getName(),
    state.getModuleRegistry(),
    state.getLogger(),
    state.getIsFullyInitialized,
    state.ensureFullyInitialized,
  );

  const pluginManager = new RobotaPluginManager(
    state.getLogger(),
    state.getIsFullyInitialized,
    state.getExecutionService,
  );

  const configManager = new RobotaConfigManager(
    state.getLogger(),
    state.getAiProviders,
    state.getTools,
    state.getEventService,
    state.getIsFullyInitialized,
    state.ensureFullyInitialized,
    state.getConfig,
    (c: IAgentConfig) => state.setConfig(c),
    state.getConfigVersion,
    state.incrementConfigVersion,
    state.getConfigUpdatedAt,
    (t: number) => state.setConfigUpdatedAt(t),
    (eventType: string, data: Record<string, unknown>) =>
      state.emitAgentEvent(eventType, data as Omit<IAgentEventData, 'timestamp'>),
  );

  return { moduleManager, pluginManager, configManager };
}
