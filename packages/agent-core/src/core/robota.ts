/**
 * Core Robota agent class.
 *
 * Heavy logic is delegated to extracted helpers:
 * - {@link RobotaModuleManager} — module lifecycle
 * - {@link RobotaPluginManager} — plugin lifecycle
 * - {@link RobotaConfigManager} — config/tool/model management
 * - {@link performAsyncInitialization} — async boot sequence
 * - {@link robotaRun}, {@link robotaRunStream} — execution turns
 * - {@link buildAgentStats}, {@link destroyAgent} — stats and teardown
 * @public
 */
import { AbstractAgent } from '../abstracts/abstract-agent';
import { TUniversalMessage, IAgentConfig, IRunOptions, IAgent } from '../interfaces/agent';
import type {
  IPluginContract,
  IPluginHooks,
  IPluginOptions,
  IPluginStats,
} from '../abstracts/abstract-plugin';
import type { IModule } from '../abstracts/abstract-module';
import { ModuleRegistry } from '../managers/module-registry';
import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AgentFactory } from '../managers/agent-factory';
import { ConversationHistory } from '../managers/conversation-history-manager';
import type { ExecutionService } from '../services/execution-service';
import type { IEventService, IAgentEventData } from '../interfaces/event-service';
import { DEFAULT_ABSTRACT_EVENT_SERVICE, bindWithOwnerPath } from '../event-service/index';
import type { AbstractTool, IToolWithEventService } from '../abstracts/abstract-tool';
import { createLogger, setGlobalLogLevel, type ILogger } from '../utils/logger';
import type { IModuleResultData } from '../abstracts/abstract-module';
import type { IHistoryEntry } from '../interfaces/messages';
import { validateAgentConfig } from './robota-config-manager';
import { createRobotaDelegates } from './robota-delegate-factory';
import type { RobotaModuleManager } from './robota-module-manager';
import type { RobotaPluginManager } from './robota-plugin-manager';
import type { RobotaConfigManager } from './robota-config-manager';
import { performDoAsyncInit } from './robota-initializer';
import { robotaRun, robotaRunStream, type IRobotaExecutionDeps } from './robota-execution';
import { buildAgentStats, destroyAgent } from './robota-lifecycle';
import {
  getHistory,
  getFullHistory,
  addHistoryEntry,
  clearHistory,
  injectMessage,
} from './robota-history';
import {
  emitCreatedEvent,
  emitAgentEvent,
  buildOwnerPath,
  createModuleEventEmitter,
} from './robota-events';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

export type { TAgentStatsMetadata } from './robota-config-manager';

/** Shared model configuration shape used in setModel / getModel. */
type TModelConfig = {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  systemMessage?: string;
};

/** Return shape of getConfiguration(). */
type TConfigurationSnapshot = {
  version: number;
  tools: Array<{ name: string; parameters?: string[] }>;
  updatedAt: number;
};

/** Return shape of getModuleStats(). */
type TModuleStats =
  | {
      totalExecutions: number;
      successfulExecutions: number;
      failedExecutions: number;
      averageExecutionTime: number;
      lastExecutionTime?: Date;
    }
  | undefined;

/** Shorthand for the plugin contract type used throughout this class. */
type TPlugin = IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks;

/**
 * Core AI agent integrating multiple AI providers, tools, and plugins
 * into a unified conversational interface.
 * @public
 */
export class Robota
  extends AbstractAgent<IAgentConfig, IRunOptions, TUniversalMessage>
  implements IAgent<IAgentConfig, IRunOptions, TUniversalMessage>
{
  public readonly name: string;
  public readonly version: string = '1.0.0';

  private aiProviders: AIProviders;
  private tools: Tools;
  private agentFactory: AgentFactory;
  private conversationHistory: ConversationHistory;
  private moduleRegistry: ModuleRegistry;
  private eventEmitter: EventEmitterPlugin;
  private executionService!: ExecutionService;
  private eventService: IEventService;
  private agentEventService: IEventService;
  protected override config: IAgentConfig;
  private conversationId: string;
  private logger: ILogger;
  private initializationPromise?: Promise<void> | undefined;
  private isFullyInitialized = false;
  private startTime: number;
  private configVersion: number = 1;
  private configUpdatedAt: number = Date.now();
  private moduleManager!: RobotaModuleManager;
  private pluginManager!: RobotaPluginManager;
  private configManager!: RobotaConfigManager;

  constructor(config: IAgentConfig) {
    super();
    this.name = config.name;
    this.config = config;
    this.conversationId =
      config.conversationId ||
      `conv_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
    this.logger = createLogger('Robota');
    this.startTime = Date.now();

    if (config.logging) {
      if (config.logging.level) setGlobalLogLevel(config.logging.level);
      if (config.logging.enabled === false) setGlobalLogLevel('silent');
    }

    validateAgentConfig(config);

    this.aiProviders = new AIProviders();
    this.tools = new Tools();
    this.agentFactory = new AgentFactory();
    this.conversationHistory = new ConversationHistory();
    this.eventEmitter = createModuleEventEmitter();
    this.moduleRegistry = new ModuleRegistry(this.eventEmitter);

    this.eventService = config.eventService || DEFAULT_ABSTRACT_EVENT_SERVICE;
    this.agentEventService = bindWithOwnerPath(this.eventService, {
      ownerType: 'agent',
      ownerId: this.conversationId,
      ownerPath: buildOwnerPath(this.conversationId, this.config.executionContext),
    });

    const delegates = createRobotaDelegates({
      getName: () => this.name,
      getModuleRegistry: () => this.moduleRegistry,
      getLogger: () => this.logger,
      getIsFullyInitialized: () => this.isFullyInitialized,
      ensureFullyInitialized: () => this.ensureFullyInitialized(),
      getExecutionService: () => this.executionService,
      getAiProviders: () => this.aiProviders,
      getTools: () => this.tools,
      getEventService: () => this.eventService,
      getConfig: () => this.config,
      setConfig: (c) => {
        this.config = c;
      },
      getConfigVersion: () => this.configVersion,
      incrementConfigVersion: () => ++this.configVersion,
      getConfigUpdatedAt: () => this.configUpdatedAt,
      setConfigUpdatedAt: (t) => {
        this.configUpdatedAt = t;
      },
      emitAgentEvent: (t, d) => this.emitAgentEvent(t, d as Omit<IAgentEventData, 'timestamp'>),
    });
    this.moduleManager = delegates.moduleManager;
    this.pluginManager = delegates.pluginManager;
    this.configManager = delegates.configManager;
    emitCreatedEvent(this.config, (t, d) => this.emitAgentEvent(t, d));
  }

  // --- Execution ---

  async run(input: string, options: IRunOptions = {}): Promise<string> {
    await this.ensureFullyInitialized();
    return robotaRun(this.executionDeps(), input, options);
  }

  async *runStream(
    input: string,
    options: IRunOptions = {},
  ): AsyncGenerator<string, void, undefined> {
    await this.ensureFullyInitialized();
    yield* robotaRunStream(this.executionDeps(), input, options);
  }

  private executionDeps(): IRobotaExecutionDeps {
    return {
      conversationId: this.conversationId,
      config: this.config,
      logger: this.logger,
      getHistory: () => this.getHistory(),
      getExecutionService: () => this.executionService,
      emitAgentEvent: (t, d) => this.emitAgentEvent(t, d),
    };
  }

  // --- History ---

  override getHistory(): TUniversalMessage[] {
    return getHistory(this.conversationHistory, this.conversationId);
  }
  getFullHistory(): IHistoryEntry[] {
    return getFullHistory(this.conversationHistory, this.conversationId);
  }
  addHistoryEntry(entry: IHistoryEntry): void {
    addHistoryEntry(this.conversationHistory, this.conversationId, entry);
  }
  override clearHistory(): void {
    clearHistory(this.conversationHistory, this.conversationId);
  }
  injectMessage(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: string,
    options?: { toolCallId?: string; name?: string },
  ): void {
    injectMessage(this.conversationHistory, this.conversationId, role, content, options);
  }

  // --- Config / Model / Tools (delegated) ---

  async updateTools(next: Array<IToolWithEventService>): Promise<{ version: number }> {
    return this.configManager.updateTools(next);
  }
  async updateConfiguration(patch: Partial<IAgentConfig>): Promise<{ version: number }> {
    return this.configManager.updateConfiguration(patch);
  }
  async getConfiguration(): Promise<TConfigurationSnapshot> {
    return this.configManager.getConfiguration();
  }
  setModel(mc: TModelConfig): void {
    this.configManager.setModel(mc);
  }
  getModel(): TModelConfig {
    return this.configManager.getModel();
  }
  registerTool(tool: AbstractTool): void {
    this.configManager.registerTool(tool, this.tools);
  }
  unregisterTool(toolName: string): void {
    this.tools.removeTool(toolName);
  }
  getConfig(): IAgentConfig {
    return { ...this.config };
  }

  // --- Plugins (delegated) ---

  addPlugin(plugin: TPlugin): void {
    this.pluginManager.addPlugin(plugin);
  }
  removePlugin(pluginName: string): boolean {
    return this.pluginManager.removePlugin(pluginName);
  }
  getPlugin(pluginName: string): TPlugin | undefined {
    return this.pluginManager.getPlugin(pluginName);
  }
  getPlugins(): TPlugin[] {
    return this.pluginManager.getPlugins();
  }
  getPluginNames(): string[] {
    return this.pluginManager.getPluginNames();
  }

  // --- Modules (delegated) ---

  async registerModule(
    module: IModule,
    options?: { autoInitialize?: boolean; validateDependencies?: boolean },
  ): Promise<void> {
    return this.moduleManager.registerModule(module, options);
  }
  async unregisterModule(moduleName: string): Promise<boolean> {
    return this.moduleManager.unregisterModule(moduleName);
  }
  getModule(moduleName: string): IModule | undefined {
    return this.moduleManager.getModule(moduleName);
  }
  getModulesByType(moduleType: string): IModule[] {
    return this.moduleManager.getModulesByType(moduleType);
  }
  getModules(): IModule[] {
    return this.moduleManager.getModules();
  }
  getModuleNames(): string[] {
    return this.moduleManager.getModuleNames();
  }
  hasModule(moduleName: string): boolean {
    return this.moduleManager.hasModule(moduleName);
  }
  async executeModule(
    moduleName: string,
    context: {
      executionId?: string;
      sessionId?: string;
      userId?: string;
      metadata?: Record<string, string | number | boolean | Date>;
    },
  ): Promise<{ success: boolean; data?: IModuleResultData; error?: Error; duration?: number }> {
    return this.moduleManager.executeModule(moduleName, context);
  }
  getModuleStats(moduleName: string): TModuleStats {
    return this.moduleManager.getModuleStats(moduleName);
  }

  // --- Stats, Lifecycle & Initialization ---

  getStats() {
    return buildAgentStats({
      name: this.name,
      version: this.version,
      conversationId: this.conversationId,
      startTime: this.startTime,
      isFullyInitialized: this.isFullyInitialized,
      aiProviders: this.aiProviders,
      tools: this.tools,
      getPluginNames: () => this.getPluginNames(),
      getModuleNames: () => this.getModuleNames(),
      getHistory: () => this.getHistory(),
    });
  }

  async destroy(): Promise<void> {
    await destroyAgent({
      name: this.name,
      isFullyInitialized: this.isFullyInitialized,
      moduleRegistry: this.moduleRegistry,
      eventEmitter: this.eventEmitter,
      executionService: this.executionService,
      logger: this.logger,
      resetState: () => {
        this.isFullyInitialized = false;
        this.initializationPromise = undefined as Promise<void> | undefined;
      },
    });
  }

  protected override async initialize(): Promise<void> {
    await this.ensureFullyInitialized();
  }

  private async ensureFullyInitialized(): Promise<void> {
    if (this.isFullyInitialized) return;
    if (!this.initializationPromise) this.initializationPromise = this.doAsyncInit();
    await this.initializationPromise;
  }

  private doAsyncInit(): Promise<void> {
    return performDoAsyncInit({
      ctx: {
        config: this.config,
        aiProviders: this.aiProviders,
        tools: this.tools,
        agentFactory: this.agentFactory,
        conversationHistory: this.conversationHistory,
        moduleRegistry: this.moduleRegistry,
        eventEmitter: this.eventEmitter,
        eventService: this.eventService,
        logger: this.logger,
      },
      setExecutionService: (svc) => {
        this.executionService = svc;
      },
      setFullyInitialized: (v) => {
        this.isFullyInitialized = v;
      },
    });
  }

  private emitAgentEvent(eventType: string, data: Omit<IAgentEventData, 'timestamp'>): void {
    emitAgentEvent(
      this.agentEventService,
      this.conversationId,
      this.config.executionContext,
      eventType,
      data,
    );
  }
}
