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
import { robotaRunStructured, robotaRunStreamStructured } from './robota-execution-structured';
import {
  getHistory,
  getFullHistory,
  addHistoryEntry,
  clearHistory,
  injectMessage,
  injectRawMessage,
} from './robota-history';
import { createConfiguredProviders, performDoAsyncInit } from './robota-initializer';
import { buildAgentStats, destroyAgent, type IDestroyResult } from './robota-lifecycle';
import { RunQueue } from './robota-run-queue';
import { DEFAULT_ABSTRACT_EVENT_SERVICE, bindWithOwnerPath } from '../event-service/index';
import { AgentFactory } from '../managers/agent-factory';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { ModuleRegistry } from '../managers/module-registry';
import { Tools } from '../managers/tool-manager';
import { normalizeStructuredOutput } from '../schema/structured-output';
import { createLogger, type ILogger } from '../utils/logger';

import type { RobotaConfigManager } from './robota-config-manager';
import type { IModelConfig, IConfigurationSnapshot } from './robota-types';
import type { AbstractTool, IToolWithEventService } from '../abstracts/abstract-tool';
import type {
  TUniversalMessage,
  IAgentConfig,
  IRunOptions,
  IAgent,
  TRunOptionsWithOutput,
} from '../interfaces/agent';
import type { IEventService, IAgentEventData } from '../interfaces/event-service';
import type { IHistoryEntry } from '../interfaces/messages';
import type { IAIProvider } from '../interfaces/provider';
import type { AIProviders } from '../managers/ai-provider-manager';
import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import type { IJsonSchemaOutput } from '../schema/structured-output';
import type { ExecutionService } from '../services/execution-service';
import type { ZodType, TypeOf } from 'zod';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

export type { TAgentStatsMetadata } from './robota-config-manager';

/** @public */
export class Robota
  extends RobotaBase
  implements IAgent<IAgentConfig, IRunOptions, TUniversalMessage>
{
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
  private conversationId: string;
  private logger: ILogger;
  private initializationPromise?: Promise<void> | undefined;
  /** Terminal state (CORE-022): once destroyed, run/runStream reject and re-init is impossible. */
  private destroyed = false;
  private isFullyInitialized = false;
  private startTime: number;
  private configVersion: number = 1;
  private configUpdatedAt: number = Date.now();
  private configManager!: RobotaConfigManager;

  constructor(config: IAgentConfig) {
    super();
    this.config = config;
    this.conversationId =
      config.conversationId ||
      `conv_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
    // CORE-029: `config.logging` is PER-AGENT and used to be applied with `setGlobalLogLevel`,
    // which is process-wide — so one agent built with `{ enabled: false }` silenced every other
    // agent, and every other package, from a constructor. The level belongs to this agent's logger.
    const logLevel =
      config.logging?.enabled === false ? ('silent' as const) : config.logging?.level;
    this.logger = createLogger('Robota', logLevel ? { level: logLevel } : {});
    this.startTime = Date.now();

    validateAgentConfig(config);

    this.aiProviders = createConfiguredProviders(config); // CORE-047 — see its docblock for why here
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
   * Build the asynchronous half — modules, plugins, the execution service — WITHOUT running a turn.
   * Idempotent. The provider registry and current model are NOT part of it: they are established by
   * the constructor (CORE-047), so reading or changing the model never needs this first.
   */
  async ensureReady(): Promise<void> {
    await this.ensureFullyInitialized();
  }

  /**
   * Concurrency contract (CORE-012): a Robota instance owns ONE conversation history, so
   * concurrent `run`/`runStream` calls on the same instance are serialized on an internal queue —
   * a call issued while another is in flight waits its turn (its `signal` is honored while queued).
   * Interleaved histories are therefore impossible by construction.
   *
   * Structured output (CORE-015): with `options.output` set the promise resolves to the validated
   * object (typed `z.infer<S>` for a Zod schema) instead of a string. Note the structured typing
   * is visible on `Robota` directly; through the generic `IAgent` interface the return type stays
   * `Promise<string>`.
   */
  run<S extends ZodType>(input: string, options: TRunOptionsWithOutput<S>): Promise<TypeOf<S>>;
  run(input: string, options: TRunOptionsWithOutput<IJsonSchemaOutput>): Promise<unknown>;
  run(input: string, options?: IRunOptions): Promise<string>;
  async run(input: string, options: IRunOptions = {}): Promise<unknown> {
    this.assertNotDestroyed();
    return this.runQueue.run(options.signal, async () => {
      await this.ensureFullyInitialized();
      try {
        if (options.output) {
          const spec = normalizeStructuredOutput(options.output);
          return await robotaRunStructured(this.executionDeps(), input, options, spec);
        }
        return await robotaRun(this.executionDeps(), input, options);
      } finally {
        this.resetEphemeralHistory();
      }
    });
  }

  runStream<S extends ZodType>(
    input: string,
    options: TRunOptionsWithOutput<S>,
  ): AsyncGenerator<string, TypeOf<S>, undefined>;
  runStream(
    input: string,
    options: TRunOptionsWithOutput<IJsonSchemaOutput>,
  ): AsyncGenerator<string, unknown, undefined>;
  runStream(input: string, options?: IRunOptions): AsyncGenerator<string, string, undefined>;
  async *runStream(
    input: string,
    options: IRunOptions = {},
  ): AsyncGenerator<string, unknown, undefined> {
    this.assertNotDestroyed();
    // Serialized like run(): the queue slot is held until the stream is fully consumed
    // (return or throw), because the conversation history is being written throughout.
    const release = await this.runQueue.acquire(options.signal);
    try {
      await this.ensureFullyInitialized();
      if (options.output) {
        const spec = normalizeStructuredOutput(options.output);
        // The validated object is the generator's return value (CORE-015).
        return yield* robotaRunStreamStructured(this.executionDeps(), input, options, spec);
      }
      return yield* robotaRunStream(this.executionDeps(), input, options);
    } finally {
      this.resetEphemeralHistory();
      release();
    }
  }

  /**
   * Run-isolated mode (CORE-014): with `retainHistory: false` the conversation store is
   * ephemeral per run — reset after every run settles (success, abort, or error) so nothing
   * accumulates across runs. The system prompt re-applies on the next run (CORE-010).
   */
  private resetEphemeralHistory(): void {
    if (this.config.retainHistory === false) {
      this.clearHistory();
    }
  }

  /** One run at a time, per instance (CORE-012). */
  private readonly runQueue = new RunQueue();

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

  /**
   * Best-effort disposal (CORE-013): never rejects for cleanup failures, so
   * `void agent.destroy()` is safe to fire-and-forget. Every cleanup step runs even if an
   * earlier one fails; failures are logged and returned in `errors` for callers that want a
   * hard signal.
   */
  async destroy(): Promise<IDestroyResult> {
    // CORE-022: idempotent terminal operation — new runs are rejected from this point,
    // and in-flight/queued runs settle before disposal begins (queue tail await).
    if (this.destroyed) return { errors: [] };
    this.destroyed = true;
    await this.runQueue.drained;
    return destroyAgent({
      name: this.name,
      isFullyInitialized: this.isFullyInitialized,
      moduleRegistry: this.moduleRegistry,
      eventEmitter: this.eventEmitter,
      executionService: this.executionService,
      // CORE-045: the disposal chain never reached these two, so a destroyed agent kept its tool
      // registry and provider map and still accepted `registerTool`.
      tools: this.tools,
      aiProviders: this.aiProviders,
      logger: this.logger,
      resetState: () => {
        this.isFullyInitialized = false;
        this.initializationPromise = undefined as Promise<void> | undefined;
      },
    });
  }

  /** CORE-022: a destroyed agent never revives — reject before touching the run queue. */
  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error(
        `[LIFECYCLE] Agent "${this.name}" has been destroyed — create a new instance`,
      );
    }
  }

  protected override async initialize(): Promise<void> {
    await this.ensureFullyInitialized();
  }

  private async ensureFullyInitialized(): Promise<void> {
    this.assertNotDestroyed();
    if (this.isFullyInitialized) return;
    if (!this.initializationPromise) {
      // CORE-022: a failed init must not be cached — clear so a later call can retry.
      this.initializationPromise = this.doAsyncInit().catch((error: unknown) => {
        this.initializationPromise = undefined;
        throw error;
      });
    }
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
