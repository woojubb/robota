import { RobotaBase } from './robota-base';
import { validateAgentConfig } from './robota-config-manager';
import { createRobotaDelegates } from './robota-delegate-factory';
import {
  emitCreatedEvent,
  emitAgentEvent,
  buildOwnerPath,
  createModuleEventEmitter,
} from './robota-events';
import { robotaRun, robotaRunStream, type IRobotaExecutionDeps } from './robota-execution';
import {
  getHistory,
  getFullHistory,
  addHistoryEntry,
  clearHistory,
  injectMessage,
  injectRawMessage,
} from './robota-history';
import { performDoAsyncInit } from './robota-initializer';
import { buildAgentStats, destroyAgent } from './robota-lifecycle';
import { DEFAULT_ABSTRACT_EVENT_SERVICE, bindWithOwnerPath } from '../event-service/index';
import { AgentFactory } from '../managers/agent-factory';
import { AIProviders } from '../managers/ai-provider-manager';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { ModuleRegistry } from '../managers/module-registry';
import { Tools } from '../managers/tool-manager';
import { createLogger, setGlobalLogLevel, type ILogger } from '../utils/logger';

import type { RobotaConfigManager } from './robota-config-manager';
import type { IModelConfig, IConfigurationSnapshot } from './robota-types';
import type { AbstractTool, IToolWithEventService } from '../abstracts/abstract-tool';
import type { TUniversalMessage, IAgentConfig, IRunOptions, IAgent } from '../interfaces/agent';
import type { IEventService, IAgentEventData } from '../interfaces/event-service';
import type { IHistoryEntry } from '../interfaces/messages';
import type { IAIProvider } from '../interfaces/provider';
import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import type { ExecutionService } from '../services/execution-service';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

export type { TAgentStatsMetadata } from './robota-config-manager';

/** @public */
export class Robota
  extends RobotaBase
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

  /**
   * Ensure the agent is fully initialized (providers registered, current provider set, execution
   * service built) WITHOUT running a turn. Idempotent. Lets callers that mutate runtime
   * configuration before the first `run()` (e.g. live preset/model switching on a fresh
   * interactive session) bring the agent to a ready state first, instead of failing the
   * "must be fully initialized" guard.
   */
  async ensureReady(): Promise<void> {
    await this.ensureFullyInitialized();
  }

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
  injectRawMessage(msg: TUniversalMessage): void {
    injectRawMessage(this.conversationHistory, this.conversationId, msg);
  }

  async updateTools(next: Array<IToolWithEventService>): Promise<{ version: number }> {
    return this.configManager.updateTools(next);
  }
  async updateConfiguration(patch: Partial<IAgentConfig>): Promise<{ version: number }> {
    return this.configManager.updateConfiguration(patch);
  }
  async getConfiguration(): Promise<IConfigurationSnapshot> {
    return this.configManager.getConfiguration();
  }
  setModel(mc: IModelConfig): void {
    this.configManager.setModel(mc);
  }
  getModel(): IModelConfig {
    return this.configManager.getModel();
  }

  /**
   * Live system-prompt update (SSOT). Updates the agent's `config.systemMessage` and the active
   * conversation store's single head system message, so the next provider request carries the
   * change. This is the propagation path for a session's persona, self-verification toggle, and
   * AGENTS.md/CLAUDE.md staleness refresh. See agent-core SPEC → System Prompt (single source of
   * truth).
   */
  updateSystemPrompt(content: string): void {
    this.configManager.setSystemMessage(content);
    this.conversationHistory.getConversationStore(this.conversationId).setSystemPrompt(content);
  }

  /** Current live system prompt. */
  getSystemPrompt(): string | undefined {
    return this.configManager.getSystemMessage();
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

  swapDefaultProvider(newProvider: IAIProvider, model: string): void {
    this.aiProviders.addProvider(newProvider.name, newProvider);
    this.configManager.setModel({ provider: newProvider.name, model });
  }

  getStats(): ReturnType<typeof buildAgentStats> {
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
