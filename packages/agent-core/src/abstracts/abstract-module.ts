/**
 * Abstract Module Base Class
 *
 * Defines the core lifecycle contract for Robota modules.
 * Type definitions live in ./abstract-module-types.ts.
 */
import type { ILogger } from '../utils/logger';
import { SilentLogger } from '../utils/logger';
import {
  EVENT_EMITTER_EVENTS,
  type IEventEmitterPlugin,
  type TEventDataValue,
} from '../plugins/event-emitter/types';
import type {
  IModuleInitializationEventData,
  IModuleExecutionEventData,
  IModuleDisposalEventData,
} from './abstract-module-events';
import {
  buildModuleContextData,
  convertModuleEventData,
  buildModuleData,
  buildModuleStats,
  filterScalarOptions,
  emitInitializeStartEvent,
  emitInitializeCompleteEvent,
  emitInitializeErrorEvent,
  emitDisposeStartEvent,
  emitDisposeCompleteEvent,
  emitDisposeErrorEvent,
} from './module-helpers';

// Re-export all types so existing importers keep working
export type {
  IModuleExecutionContext,
  IModuleExecutionResult,
  IModuleResultData,
  IBaseModuleOptions,
  IModuleCapabilities,
  IModuleDescriptor,
  IModuleData,
  IModuleStats,
  IModule,
  IBaseModule,
  IModuleHooks,
} from './abstract-module-types';
export { ModuleCategory, ModuleLayer } from './abstract-module-types';

import type {
  IModuleExecutionContext,
  IModuleExecutionResult,
  IModuleResultData,
  IBaseModuleOptions,
  IModuleCapabilities,
  IModuleDescriptor,
  IModuleData,
  IModuleStats,
  IModule,
  IModuleHooks,
} from './abstract-module-types';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;

/**
 * Abstract base class for all modules with type parameter support.
 *
 * Every Module must be an optional extension feature:
 * - Robota must work normally without any Module
 * - Adding a Module should only grant new capabilities or features
 */
export abstract class AbstractModule<
    TOptions extends IBaseModuleOptions = IBaseModuleOptions,
    TStats = IModuleStats,
  >
  implements IModule<TOptions, TStats>, IModuleHooks
{
  abstract readonly name: string;
  abstract readonly version: string;
  public enabled = true;
  public initialized = false;
  protected options: TOptions | undefined;
  protected eventEmitter: IEventEmitterPlugin | undefined;
  protected logger: ILogger;
  protected stats = {
    executionCount: 0,
    errorCount: 0,
    lastActivity: undefined as Date | undefined,
    totalExecutionTime: 0,
  };

  constructor(logger: ILogger = SilentLogger) {
    this.logger = logger;
  }

  abstract getModuleType(): IModuleDescriptor;
  abstract getCapabilities(): IModuleCapabilities;

  async initialize(options?: TOptions, eventEmitter?: IEventEmitterPlugin): Promise<void> {
    this.options = options;
    this.eventEmitter = eventEmitter;
    this.enabled =
      options && 'enabled' in options && typeof options.enabled === 'boolean'
        ? options.enabled
        : true;
    const startTime = Date.now();
    const moduleType = this.getModuleType().type;
    const filteredOptions = options
      ? filterScalarOptions(options as Record<string, unknown>)
      : undefined;
    await emitInitializeStartEvent(
      this.eventEmitter,
      this.enabled,
      this.name,
      moduleType,
      filteredOptions,
    );
    try {
      await this.onInitialize(options);
      this.initialized = true;
      await emitInitializeCompleteEvent(
        this.eventEmitter,
        this.enabled,
        this.name,
        moduleType,
        startTime,
      );
    } catch (error) {
      this.initialized = false;
      const errObj = error instanceof Error ? error : new Error(String(error));
      await emitInitializeErrorEvent(this.eventEmitter, this.name, moduleType, startTime, errObj);
      throw error;
    }
  }

  protected async onInitialize(_options?: TOptions): Promise<void> {
    /* override in subclass */
  }

  async execute(context: IModuleExecutionContext): Promise<IModuleExecutionResult> {
    if (!this.enabled) throw new Error(`Module ${this.name} is disabled`);
    if (!this.initialized) throw new Error(`Module ${this.name} is not initialized`);
    const startTime = Date.now();
    const executionId =
      context.executionId ||
      `exec_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
    const contextData = this.buildContextData(context);

    if (this.eventEmitter) {
      await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START, {
        data: this.convertToEventData({
          moduleName: this.name,
          moduleType: this.getModuleType().type,
          phase: 'start',
          executionId,
          timestamp: new Date(),
          inputSize: JSON.stringify(context).length,
          ...(Object.keys(contextData).length > 0 && { context: contextData }),
        }),
        timestamp: new Date(),
      });
    }

    try {
      await this.beforeExecution?.(context);
      const result = await this.onExecute(context);
      const duration = Date.now() - startTime;
      this.stats.executionCount++;
      this.stats.lastActivity = new Date();
      this.stats.totalExecutionTime += duration;
      const finalResult = { ...result, duration };
      await this.afterExecution?.(context, finalResult);
      if (this.eventEmitter) {
        await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE, {
          data: this.convertToEventData({
            moduleName: this.name,
            moduleType: this.getModuleType().type,
            phase: 'complete',
            executionId,
            timestamp: new Date(),
            duration,
            success: finalResult.success,
            outputSize: finalResult.data ? JSON.stringify(finalResult.data).length : 0,
            ...(Object.keys(contextData).length > 0 && { context: contextData }),
          }),
          timestamp: new Date(),
        });
      }
      return finalResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.stats.errorCount++;
      this.stats.lastActivity = new Date();
      const errObj = error instanceof Error ? error : new Error(String(error));
      await this.onError?.(errObj, context);
      if (this.eventEmitter) {
        await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR, {
          data: this.convertToEventData({
            moduleName: this.name,
            moduleType: this.getModuleType().type,
            phase: 'error',
            executionId,
            timestamp: new Date(),
            duration,
            success: false,
            error: errObj.message,
            ...(Object.keys(contextData).length > 0 && { context: contextData }),
          }),
          error: errObj,
          timestamp: new Date(),
        });
      }
      throw errObj;
    }
  }

  protected async onExecute(_context: IModuleExecutionContext): Promise<IModuleExecutionResult> {
    throw new Error(`Module ${this.name} does not implement execute functionality`);
  }

  async dispose(): Promise<void> {
    const startTime = Date.now();
    const moduleType = this.getModuleType().type;
    await emitDisposeStartEvent(this.eventEmitter, this.initialized, this.name, moduleType);
    try {
      await this.onDispose();
      this.initialized = false;
      this.enabled = false;
      await emitDisposeCompleteEvent(this.eventEmitter, this.name, moduleType, startTime);
    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      await emitDisposeErrorEvent(this.eventEmitter, this.name, moduleType, startTime, errObj);
      throw error;
    }
  }

  protected async onDispose(): Promise<void> {
    /* override in subclass */
  }
  enable(): void {
    this.enabled = true;
  }
  disable(): void {
    this.enabled = false;
  }
  isEnabled(): boolean {
    return this.enabled;
  }
  isInitialized(): boolean {
    return this.initialized;
  }

  getData(): IModuleData {
    return buildModuleData(
      this.name,
      this.version,
      () => this.getModuleType(),
      this.enabled,
      this.initialized,
      () => this.getCapabilities(),
    );
  }

  getStats(): TStats {
    return buildModuleStats(this.stats, this.enabled, this.initialized) as TStats;
  }

  getStatus(): {
    name: string;
    version: string;
    type: string;
    enabled: boolean;
    initialized: boolean;
    hasEventEmitter: boolean;
  } {
    return {
      name: this.name,
      version: this.version,
      type: this.getModuleType().type,
      enabled: this.enabled,
      initialized: this.initialized,
      hasEventEmitter: !!this.eventEmitter,
    };
  }

  private buildContextData(context: IModuleExecutionContext): Record<string, string> {
    return buildModuleContextData(context);
  }

  private convertToEventData(
    data: IModuleInitializationEventData | IModuleExecutionEventData | IModuleDisposalEventData,
  ): Record<string, TEventDataValue> {
    return convertModuleEventData(data);
  }

  async beforeExecution?(context: IModuleExecutionContext): Promise<void>;
  async afterExecution?(
    context: IModuleExecutionContext,
    result: IModuleExecutionResult,
  ): Promise<void>;
  async onActivate?(): Promise<void>;
  async onDeactivate?(): Promise<void>;
  async onError?(error: Error, context?: IModuleExecutionContext): Promise<void>;
}

/** Re-exported event data types for backward compatibility. */
export type {
  IBaseModuleEventData,
  IModuleInitializationEventData,
  IModuleExecutionEventData,
  IModuleDisposalEventData,
  IModuleCapabilityEventData,
  IModuleHealthEventData,
} from './abstract-module-events';
