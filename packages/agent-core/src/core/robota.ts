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
import {
  TUniversalMessage,
  IAgentConfig,
  IRunOptions,
  IAgent,
  IExecutionContextInjection,
} from '../interfaces/agent';
import type {
  IPluginContract,
  IPluginHooks,
  IPluginOptions,
  IPluginStats,
} from '../abstracts/abstract-plugin';
import type { IModule } from '../abstracts/abstract-module';
import { ModuleRegistry } from '../managers/module-registry';
import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../plugins/event-emitter/types';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AgentFactory } from '../managers/agent-factory';
import { ConversationHistory } from '../managers/conversation-history-manager';
import type { ExecutionService } from '../services/execution-service';
import { AGENT_EVENTS, AGENT_EVENT_PREFIX } from '../agents/constants';
import type {
  IEventService,
  IOwnerPathSegment,
  IAgentEventData,
} from '../interfaces/event-service';
import {
  DEFAULT_ABSTRACT_EVENT_SERVICE,
  isDefaultEventService,
  bindWithOwnerPath,
} from '@robota-sdk/agent-event-service';
import type { AbstractTool, IToolWithEventService } from '../abstracts/abstract-tool';
import { createLogger, setGlobalLogLevel, type ILogger } from '../utils/logger';
import type { IModuleResultData } from '../abstracts/abstract-module';
import { RobotaModuleManager } from './robota-module-manager';
import { RobotaPluginManager } from './robota-plugin-manager';
import { RobotaConfigManager, validateAgentConfig } from './robota-config-manager';
import { performAsyncInitialization } from './robota-initializer';
import { robotaRun, robotaRunStream, type IRobotaExecutionDeps } from './robota-execution';
import { buildAgentStats, destroyAgent } from './robota-lifecycle';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

export type { TAgentStatsMetadata } from './robota-config-manager';

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
    this.eventEmitter = new EventEmitterPlugin({
      enabled: true,
      events: [
        EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START,
        EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
        EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
        EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START,
        EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE,
        EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
        EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START,
        EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE,
        EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR,
      ],
    });
    this.moduleRegistry = new ModuleRegistry(this.eventEmitter);

    this.eventService = config.eventService || DEFAULT_ABSTRACT_EVENT_SERVICE;
    this.agentEventService = bindWithOwnerPath(this.eventService, {
      ownerType: 'agent',
      ownerId: this.conversationId,
      ownerPath: this.buildOwnerPath(this.config.executionContext),
    });

    this.initDelegates();
    this.emitCreatedEvent();
  }

  private initDelegates(): void {
    this.moduleManager = new RobotaModuleManager(
      this.name,
      this.moduleRegistry,
      this.logger,
      () => this.isFullyInitialized,
      () => this.ensureFullyInitialized(),
    );
    this.pluginManager = new RobotaPluginManager(
      this.logger,
      () => this.isFullyInitialized,
      () => this.executionService,
    );
    this.configManager = new RobotaConfigManager(
      this.logger,
      () => this.aiProviders,
      () => this.tools,
      () => this.eventService,
      () => this.isFullyInitialized,
      () => this.ensureFullyInitialized(),
      () => this.config,
      (c: IAgentConfig) => {
        this.config = c;
      },
      () => this.configVersion,
      () => ++this.configVersion,
      () => this.configUpdatedAt,
      (t: number) => {
        this.configUpdatedAt = t;
      },
      (eventType: string, data: Record<string, unknown>) => {
        this.emitAgentEvent(eventType, data as Omit<IAgentEventData, 'timestamp'>);
      },
    );
  }

  private emitCreatedEvent(): void {
    const toolNames: string[] = Array.isArray(this.config.tools)
      ? this.config.tools
          .map((t) => {
            const sn = t?.schema?.name;
            if (typeof sn === 'string' && sn.length > 0) return sn;
            const nm = (t as { name?: string } | undefined)?.name;
            if (typeof nm === 'string' && nm.length > 0) return nm;
            return '';
          })
          .filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [];
    this.emitAgentEvent(AGENT_EVENTS.CREATED, {
      parameters: {
        tools: toolNames,
        systemMessage: this.config.defaultModel.systemMessage,
        provider: this.config.defaultModel.provider,
        model: this.config.defaultModel.model,
        temperature: this.config.defaultModel.temperature,
        maxTokens: this.config.defaultModel.maxTokens,
      },
    });
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
    const session = this.conversationHistory.getConversationSession(this.conversationId);
    return session.getMessages().map((msg) => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp,
      metadata: msg.metadata,
      ...(msg.role === 'assistant' && 'toolCalls' in msg ? { toolCalls: msg.toolCalls } : {}),
      ...(msg.role === 'tool' && 'toolCallId' in msg ? { toolCallId: msg.toolCallId } : {}),
    })) as TUniversalMessage[];
  }

  override clearHistory(): void {
    this.conversationHistory.getConversationSession(this.conversationId).clear();
  }

  // --- Config / Model / Tools (delegated) ---

  async updateTools(next: Array<IToolWithEventService>): Promise<{ version: number }> {
    return this.configManager.updateTools(next);
  }
  async updateConfiguration(patch: Partial<IAgentConfig>): Promise<{ version: number }> {
    return this.configManager.updateConfiguration(patch);
  }
  async getConfiguration(): Promise<{
    version: number;
    tools: Array<{ name: string; parameters?: string[] }>;
    updatedAt: number;
  }> {
    return this.configManager.getConfiguration();
  }
  setModel(mc: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    systemMessage?: string;
  }): void {
    this.configManager.setModel(mc);
  }
  getModel(): {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    systemMessage?: string;
  } {
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

  addPlugin(plugin: IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks): void {
    this.pluginManager.addPlugin(plugin);
  }
  removePlugin(pluginName: string): boolean {
    return this.pluginManager.removePlugin(pluginName);
  }
  getPlugin(
    pluginName: string,
  ): (IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks) | undefined {
    return this.pluginManager.getPlugin(pluginName);
  }
  getPlugins(): Array<IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks> {
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
  getModuleStats(moduleName: string):
    | {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        averageExecutionTime: number;
        lastExecutionTime?: Date;
      }
    | undefined {
    return this.moduleManager.getModuleStats(moduleName);
  }

  // --- Stats & Lifecycle ---

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

  // --- Initialization ---

  protected override async initialize(): Promise<void> {
    await this.ensureFullyInitialized();
  }

  private async ensureFullyInitialized(): Promise<void> {
    if (this.isFullyInitialized) return;
    if (!this.initializationPromise) this.initializationPromise = this.doAsyncInit();
    await this.initializationPromise;
  }

  private async doAsyncInit(): Promise<void> {
    try {
      this.executionService = await performAsyncInitialization({
        config: this.config,
        aiProviders: this.aiProviders,
        tools: this.tools,
        agentFactory: this.agentFactory,
        conversationHistory: this.conversationHistory,
        moduleRegistry: this.moduleRegistry,
        eventEmitter: this.eventEmitter,
        eventService: this.eventService,
        logger: this.logger,
      });
      this.isFullyInitialized = true;
    } catch (error) {
      this.logger.error('Robota initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // --- Internal helpers ---

  private emitAgentEvent(eventType: string, data: Omit<IAgentEventData, 'timestamp'>): void {
    if (isDefaultEventService(this.agentEventService)) return;
    this.agentEventService.emit(
      eventType,
      { timestamp: new Date(), ...data },
      {
        ownerType: AGENT_EVENT_PREFIX,
        ownerId: this.conversationId,
        ownerPath: this.buildOwnerPath(this.config.executionContext),
      },
    );
  }

  private buildOwnerPath(executionContext?: IExecutionContextInjection): IOwnerPathSegment[] {
    const base = executionContext?.ownerPath?.length
      ? executionContext.ownerPath.map((segment) => ({ ...segment }))
      : [];
    return [...base, { type: 'agent', id: this.conversationId }];
  }
}
