/**
 * Factory functions for creating the ConversationAgent delegate managers.
 *
 * Extracted from core/agent.ts to keep that file under 300 lines.
 * Creates AgentModuleManager, AgentPluginManager, and AgentConfigManager
 * with all required closures bound to the ConversationAgent instance state.
 */
import { AgentConfigManager } from './agent-config-manager';
import { AgentModuleManager } from './agent-module-manager';
import { AgentPluginManager } from './agent-plugin-manager';

import type { IAgentConfig } from '../interfaces/agent';
import type { IAgentEventData } from '../interfaces/event-service';
import type { IEventService } from '../interfaces/event-service';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { ModuleRegistry } from '../managers/module-registry';
import type { Tools } from '../managers/tool-manager';
import type { ExecutionService } from '../services/execution-service';
import type { ILogger } from '../utils/logger';

/**
 * Mutable state references for the ConversationAgent instance.
 * All fields are accessed via getters/setters to allow live binding.
 */
export interface IAgentDelegateState {
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
 * Create all three delegate managers for a ConversationAgent instance.
 */
export function createAgentDelegates(state: IAgentDelegateState): {
  moduleManager: AgentModuleManager;
  pluginManager: AgentPluginManager;
  configManager: AgentConfigManager;
} {
  const moduleManager = new AgentModuleManager(
    state.getName(),
    state.getModuleRegistry(),
    state.getLogger(),
    state.getIsFullyInitialized,
    state.ensureFullyInitialized,
  );

  const pluginManager = new AgentPluginManager(
    state.getLogger(),
    state.getIsFullyInitialized,
    state.getExecutionService,
  );

  const configManager = new AgentConfigManager(
    state.getLogger(),
    state.getAiProviders,
    state.getTools,
    state.getEventService,
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
