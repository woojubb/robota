/**
 * Abstract Module Base Class
 *
 * Defines the core lifecycle contract for Robota modules.
 * Type definitions live in ./abstract-module-types.ts.
 */
import type { ILogger } from '../utils/logger';
import { SilentLogger } from '../utils/logger';
import { EVENT_EMITTER_EVENTS, type IEventEmitterPlugin, type TEventDataValue } from '../plugins/event-emitter/types';
import type { IModuleInitializationEventData, IModuleExecutionEventData, IModuleDisposalEventData } from './abstract-module-events';

// Re-export all types so existing importers keep working
export type {
    IModuleExecutionContext, IModuleExecutionResult, IModuleResultData,
    IBaseModuleOptions, IModuleCapabilities, IModuleDescriptor,
    IModuleData, IModuleStats, IModule, IBaseModule, IModuleHooks
} from './abstract-module-types';
export { ModuleCategory, ModuleLayer } from './abstract-module-types';

import type {
    IModuleExecutionContext, IModuleExecutionResult, IModuleResultData,
    IBaseModuleOptions, IModuleCapabilities, IModuleDescriptor,
    IModuleData, IModuleStats, IModule, IModuleHooks
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
export abstract class AbstractModule<TOptions extends IBaseModuleOptions = IBaseModuleOptions, TStats = IModuleStats>
    implements IModule<TOptions, TStats>, IModuleHooks {

    abstract readonly name: string;
    abstract readonly version: string;
    public enabled = true;
    public initialized = false;
    protected options: TOptions | undefined;
    protected eventEmitter: IEventEmitterPlugin | undefined;
    protected logger: ILogger;
    protected stats = { executionCount: 0, errorCount: 0, lastActivity: undefined as Date | undefined, totalExecutionTime: 0 };

    constructor(logger: ILogger = SilentLogger) { this.logger = logger; }

    abstract getModuleType(): IModuleDescriptor;
    abstract getCapabilities(): IModuleCapabilities;

    async initialize(options?: TOptions, eventEmitter?: IEventEmitterPlugin): Promise<void> {
        this.options = options;
        this.eventEmitter = eventEmitter;
        if (options && 'enabled' in options && typeof options.enabled === 'boolean') { this.enabled = options.enabled; } else { this.enabled = true; }
        const startTime = Date.now();

        if (this.eventEmitter && this.enabled) {
            const filteredOptions = options ? Object.fromEntries(Object.entries(options).filter(([_, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) : undefined;
            await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START, {
                data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'start', timestamp: new Date(), ...(filteredOptions && Object.keys(filteredOptions).length > 0 && { options: filteredOptions }) }),
                timestamp: new Date()
            });
        }

        try {
            await this.onInitialize(options);
            this.initialized = true;
            if (this.eventEmitter && this.enabled) {
                await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE, {
                    data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'complete', timestamp: new Date(), duration: Date.now() - startTime }),
                    timestamp: new Date()
                });
            }
        } catch (error) {
            this.initialized = false;
            if (this.eventEmitter) {
                await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR, {
                    data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'error', timestamp: new Date(), duration: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) }),
                    error: error instanceof Error ? error : new Error(String(error)), timestamp: new Date()
                });
            }
            throw error;
        }
    }

    protected async onInitialize(_options?: TOptions): Promise<void> { /* override in subclass */ }

    async execute(context: IModuleExecutionContext): Promise<IModuleExecutionResult> {
        if (!this.enabled) throw new Error(`Module ${this.name} is disabled`);
        if (!this.initialized) throw new Error(`Module ${this.name} is not initialized`);
        const startTime = Date.now();
        const executionId = context.executionId || `exec_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
        const contextData = this.buildContextData(context);

        if (this.eventEmitter) {
            await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START, {
                data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'start', executionId, timestamp: new Date(), inputSize: JSON.stringify(context).length, ...(Object.keys(contextData).length > 0 && { context: contextData }) }),
                timestamp: new Date()
            });
        }

        try {
            await this.beforeExecution?.(context);
            const result = await this.onExecute(context);
            const duration = Date.now() - startTime;
            this.stats.executionCount++; this.stats.lastActivity = new Date(); this.stats.totalExecutionTime += duration;
            const finalResult = { ...result, duration };
            await this.afterExecution?.(context, finalResult);
            if (this.eventEmitter) {
                await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE, {
                    data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'complete', executionId, timestamp: new Date(), duration, success: finalResult.success, outputSize: finalResult.data ? JSON.stringify(finalResult.data).length : 0, ...(Object.keys(contextData).length > 0 && { context: contextData }) }),
                    timestamp: new Date()
                });
            }
            return finalResult;
        } catch (error) {
            const duration = Date.now() - startTime;
            this.stats.errorCount++; this.stats.lastActivity = new Date();
            const errObj = error instanceof Error ? error : new Error(String(error));
            await this.onError?.(errObj, context);
            if (this.eventEmitter) {
                await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR, {
                    data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'error', executionId, timestamp: new Date(), duration, success: false, error: errObj.message, ...(Object.keys(contextData).length > 0 && { context: contextData }) }),
                    error: errObj, timestamp: new Date()
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
        if (this.eventEmitter && this.initialized) {
            await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START, {
                data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'start', timestamp: new Date() }),
                timestamp: new Date()
            });
        }
        try {
            await this.onDispose();
            this.initialized = false; this.enabled = false;
            if (this.eventEmitter) {
                await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE, {
                    data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'complete', timestamp: new Date(), duration: Date.now() - startTime, resourcesReleased: ['memory', 'event-handlers', 'timers'] }),
                    timestamp: new Date()
                });
            }
        } catch (error) {
            if (this.eventEmitter) {
                await this.eventEmitter.emit(EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR, {
                    data: this.convertToEventData({ moduleName: this.name, moduleType: this.getModuleType().type, phase: 'error', timestamp: new Date(), duration: Date.now() - startTime, error: error instanceof Error ? error.message : String(error) }),
                    error: error instanceof Error ? error : new Error(String(error)), timestamp: new Date()
                });
            }
            throw error;
        }
    }

    protected async onDispose(): Promise<void> { /* override in subclass */ }
    enable(): void { this.enabled = true; }
    disable(): void { this.enabled = false; }
    isEnabled(): boolean { return this.enabled; }
    isInitialized(): boolean { return this.initialized; }

    getData(): IModuleData {
        return { name: this.name, version: this.version, type: this.getModuleType().type, enabled: this.enabled, initialized: this.initialized, capabilities: this.getCapabilities(), metadata: { category: this.getModuleType().category, layer: this.getModuleType().layer } };
    }

    getStats(): TStats {
        const avg = this.stats.executionCount > 0 ? this.stats.totalExecutionTime / this.stats.executionCount : undefined;
        const base: IModuleStats = { enabled: this.enabled, initialized: this.initialized, executionCount: this.stats.executionCount, errorCount: this.stats.errorCount, ...(this.stats.lastActivity && { lastActivity: this.stats.lastActivity }), ...(avg !== undefined && { averageExecutionTime: avg }) };
        return base as TStats;
    }

    getStatus(): { name: string; version: string; type: string; enabled: boolean; initialized: boolean; hasEventEmitter: boolean } {
        return { name: this.name, version: this.version, type: this.getModuleType().type, enabled: this.enabled, initialized: this.initialized, hasEventEmitter: !!this.eventEmitter };
    }

    private buildContextData(context: IModuleExecutionContext): Record<string, string> {
        const cd: Record<string, string> = {};
        if (context['sessionId']) cd['sessionId'] = context['sessionId'];
        if (context['userId']) cd['userId'] = context['userId'];
        if (context['agentName']) cd['agentName'] = context['agentName'];
        return cd;
    }

    private convertToEventData(data: IModuleInitializationEventData | IModuleExecutionEventData | IModuleDisposalEventData): Record<string, TEventDataValue> {
        const payload: Record<string, TEventDataValue> = { moduleName: data.moduleName, moduleType: data.moduleType, timestamp: data.timestamp.toISOString() };
        if (data.metadata) payload['metadata'] = data.metadata;
        if ('phase' in data) payload['phase'] = data.phase;
        if ('duration' in data && data.duration !== undefined) payload['duration'] = data.duration;
        if ('error' in data && data.error !== undefined) payload['error'] = data.error;
        if ('options' in data && data.options) payload['options'] = data.options;
        if ('executionId' in data) payload['executionId'] = data.executionId;
        if ('success' in data && data.success !== undefined) payload['success'] = data.success;
        if ('inputSize' in data && data.inputSize !== undefined) payload['inputSize'] = data.inputSize;
        if ('outputSize' in data && data.outputSize !== undefined) payload['outputSize'] = data.outputSize;
        if ('context' in data && data.context) payload['context'] = data.context;
        return payload;
    }

    async beforeExecution?(context: IModuleExecutionContext): Promise<void>;
    async afterExecution?(context: IModuleExecutionContext, result: IModuleExecutionResult): Promise<void>;
    async onActivate?(): Promise<void>;
    async onDeactivate?(): Promise<void>;
    async onError?(error: Error, context?: IModuleExecutionContext): Promise<void>;
}

/** Re-exported event data types for backward compatibility. */
export type {
    IBaseModuleEventData, IModuleInitializationEventData, IModuleExecutionEventData,
    IModuleDisposalEventData, IModuleCapabilityEventData, IModuleHealthEventData
} from './abstract-module-events';
