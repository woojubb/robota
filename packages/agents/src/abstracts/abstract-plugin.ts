/**
 * Abstract class for all plugins with type parameter support.
 *
 * Type definitions live in ./abstract-plugin-types.ts.
 */
import type { IRunOptions } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { TToolParameters, IToolExecutionResult, IToolExecutionContext } from '../interfaces/tool';
import type { IEventEmitterEventData, IEventEmitterPlugin, TEventName } from '../plugins/event-emitter/types';
import { EVENT_EMITTER_EVENTS } from '../plugins/event-emitter/types';
import { createLogger, type ILogger } from '../utils/logger';
import type { IPluginOptions, IPluginStats, IPluginConfig, IPluginData, IPluginContract, IPluginHooks, IPluginExecutionContext, IPluginExecutionResult, IPluginErrorContext } from './abstract-plugin-types';
import { PluginCategory, PluginPriority } from './abstract-plugin-types';

// Re-export all types for backward compatibility
export type { IPluginOptions, IPluginStats, IPluginConfig, IPluginData, IPluginContract, IPluginHooks, IPluginExecutionContext, IPluginExecutionResult, IPluginErrorContext };
export type { IPlugin } from './abstract-plugin-types';
export { PluginCategory, PluginPriority };

/**
 * Abstract class for all plugins with type parameter support.
 * Provides plugin lifecycle management and common functionality.
 * @template TOptions - Plugin options type that extends IPluginOptions
 * @template TStats - Plugin statistics type
 */
export abstract class AbstractPlugin<TOptions extends IPluginOptions = IPluginOptions, TStats extends IPluginStats = IPluginStats>
    implements IPluginContract<TOptions, TStats>, IPluginHooks {
    abstract readonly name: string;
    abstract readonly version: string;
    public enabled = true;
    public category: PluginCategory = PluginCategory.CUSTOM;
    public priority: number = PluginPriority.NORMAL;
    protected options: TOptions | undefined;
    protected eventEmitter: IEventEmitterPlugin | undefined;
    protected subscribedEvents: TEventName[] = [];
    protected eventHandlers = new Map<TEventName, string[]>();
    protected readonly pluginLogger: ILogger = createLogger('AbstractPlugin');
    protected stats = { calls: 0, errors: 0, moduleEventsReceived: 0, lastActivity: undefined as Date | undefined };

    async initialize(options?: TOptions): Promise<void> {
        this.options = options;
        if (options && 'enabled' in options && typeof options.enabled === 'boolean') this.enabled = options.enabled; else this.enabled = true;
        if (options?.category) this.category = options.category;
        if (options?.priority !== undefined) this.priority = typeof options.priority === 'number' ? options.priority : options.priority;
    }

    async subscribeToModuleEvents(eventEmitter: IEventEmitterPlugin): Promise<void> {
        this.eventEmitter = eventEmitter;
        if (!this.options) return;
        const eventsToSubscribe: TEventName[] = [];
        if (this.options.subscribeToAllModuleEvents) {
            eventsToSubscribe.push(
                EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START, EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE, EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
                EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START, EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE, EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
                EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START, EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE, EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR
            );
        }
        if (this.options.moduleEvents) eventsToSubscribe.push(...this.options.moduleEvents);
        for (const eventType of eventsToSubscribe) {
            const handlerId = this.eventEmitter.on(eventType, async (eventData: IEventEmitterEventData) => {
                try { this.stats.moduleEventsReceived++; this.stats.lastActivity = new Date(); await this.onModuleEvent?.(eventType, eventData); }
                catch (error) { this.stats.errors++; const safeError = error instanceof Error ? error : new Error(String(error)); this.pluginLogger.error(`Plugin "${this.name}" failed to handle module event "${String(eventType)}"`, { plugin: this.name, eventType: String(eventType), error: safeError.message }); }
            });
            const existing = this.eventHandlers.get(eventType);
            if (existing) existing.push(handlerId); else this.eventHandlers.set(eventType, [handlerId]);
            this.subscribedEvents.push(eventType);
        }
    }

    async unsubscribeFromModuleEvents(eventEmitter: IEventEmitterPlugin): Promise<void> {
        for (const [eventType, handlerIds] of this.eventHandlers.entries()) { for (const handlerId of handlerIds) eventEmitter.off(eventType, handlerId); }
        this.eventHandlers.clear(); this.subscribedEvents = []; this.eventEmitter = undefined;
    }

    async dispose(): Promise<void> { if (this.eventEmitter) await this.unsubscribeFromModuleEvents(this.eventEmitter); }
    enable(): void { this.enabled = true; }
    disable(): void { this.enabled = false; }
    isEnabled(): boolean { return this.enabled; }
    getConfig(): IPluginConfig { return {}; }
    updateConfig(_config: IPluginConfig): void { /* override in subclass */ }

    getData(): IPluginData {
        return { name: this.name, version: this.version, enabled: this.enabled, category: this.category, priority: this.priority, subscribedEvents: [...this.subscribedEvents], metadata: { moduleEventsReceived: this.stats.moduleEventsReceived, totalCalls: this.stats.calls, totalErrors: this.stats.errors } };
    }

    clearData?(): void;

    getStatus(): { name: string; version: string; enabled: boolean; initialized: boolean; category: PluginCategory; priority: number; subscribedEventsCount: number; hasEventEmitter: boolean } {
        return { name: this.name, version: this.version, enabled: this.enabled, initialized: true, category: this.category, priority: this.priority, subscribedEventsCount: this.subscribedEvents.length, hasEventEmitter: !!this.eventEmitter };
    }

    getStats(): TStats {
        const baseStats: IPluginStats = { enabled: this.enabled, calls: this.stats.calls, errors: this.stats.errors, moduleEventsReceived: this.stats.moduleEventsReceived, ...(this.stats.lastActivity && { lastActivity: this.stats.lastActivity }) };
        return baseStats as TStats;
    }

    protected updateCallStats(): void { this.stats.calls++; this.stats.lastActivity = new Date(); }
    protected updateErrorStats(): void { this.stats.errors++; this.stats.lastActivity = new Date(); }

    // Optional lifecycle hooks - plugins can override these
    async beforeRun?(input: string, options?: IRunOptions): Promise<void>;
    async afterRun?(input: string, response: string, options?: IRunOptions): Promise<void>;
    async beforeExecution?(context: IPluginExecutionContext): Promise<void>;
    async afterExecution?(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void>;
    async beforeConversation?(context: IPluginExecutionContext): Promise<void>;
    async afterConversation?(context: IPluginExecutionContext, result: IPluginExecutionResult): Promise<void>;
    async beforeToolCall?(toolName: string, parameters: TToolParameters): Promise<void>;
    async beforeToolExecution?(context: IPluginExecutionContext, toolData: IToolExecutionContext): Promise<void>;
    async afterToolCall?(toolName: string, parameters: TToolParameters, result: IToolExecutionResult): Promise<void>;
    async afterToolExecution?(context: IPluginExecutionContext, toolResults: IPluginExecutionResult): Promise<void>;
    async beforeProviderCall?(messages: TUniversalMessage[]): Promise<void>;
    async afterProviderCall?(messages: TUniversalMessage[], response: TUniversalMessage): Promise<void>;
    async onStreamingChunk?(chunk: TUniversalMessage): Promise<void>;
    async onError?(error: Error, context?: IPluginErrorContext): Promise<void>;
    async onMessageAdded?(message: TUniversalMessage): Promise<void>;
    async onModuleEvent?(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void>;
}
