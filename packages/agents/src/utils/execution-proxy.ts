import type { IBaseEventData, IEventService } from '../services/event-service';
import { EXECUTION_EVENTS } from '../services/execution-service';
import { TOOL_EVENTS } from '../services/tool-execution-service';
import { AGENT_EVENTS } from '../agents/constants';
import { TASK_EVENTS } from '../services/task-events';
import type { IUniversalObjectValue, TUniversalValue } from '../interfaces/types';

/**
 * Configuration for execution proxy
 */
export interface IExecutionProxyConfig {
    eventService: IEventService;
    sourceType: 'agent' | 'team' | 'tool';
    sourceId: string;
    enabledEvents?: {
        execution?: boolean;
        toolCall?: boolean;
        task?: boolean;
    };
}

/**
 * Metadata extractor function type
 */
type TExecutionProxyTarget = Record<string, TUniversalValue>;
type TExecutionProxyArgs = TUniversalValue[];

function asObjectValue(input: TUniversalValue | undefined): IUniversalObjectValue | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Date) {
        return undefined;
    }
    return input as IUniversalObjectValue;
}

function getStringLength(input: TUniversalValue | undefined): number {
    return typeof input === 'string' ? input.length : 0;
}

export type TMetadataExtractor = (
    target: TExecutionProxyTarget,
    methodName: string,
    args: TExecutionProxyArgs
) => Record<string, TUniversalValue>;

/**
 * Method configuration for proxy
 */
export interface IMethodConfig {
    startEvent?: string;
    completeEvent?: string;
    errorEvent?: string;
    extractMetadata?: TMetadataExtractor;
    extractResult?: (result: TUniversalValue) => Record<string, TUniversalValue>;
}

/**
 * ExecutionProxy - Automatic event emission using Proxy pattern
 * 
 * This class wraps target objects and automatically emits events
 * around method execution without modifying business logic.
 * 
 * Benefits:
 * - Zero business logic pollution
 * - Automatic event emission
 * - Configurable per method
 * - AOP (Aspect-Oriented Programming) pattern
 */
export class ExecutionProxy<T extends object = object> {
    private config: IExecutionProxyConfig;
    private methodConfigs: Map<string, IMethodConfig> = new Map();

    constructor(config: IExecutionProxyConfig) {
        this.config = config;
    }

    /**
     * Configure specific methods for event emission
     */
    configureMethod(methodName: string, config: IMethodConfig): this {
        this.methodConfigs.set(methodName, config);
        return this;
    }

    /**
     * Configure multiple methods with standard patterns
     */
    configureStandardMethods(): this {
        // Agent execution methods
        if (this.config.sourceType === 'agent') {
            this.configureMethod('run', {
                startEvent: AGENT_EVENTS.EXECUTION_START,
                completeEvent: AGENT_EVENTS.EXECUTION_COMPLETE,
                errorEvent: AGENT_EVENTS.EXECUTION_ERROR,
                extractMetadata: (target, methodName, args) => ({
                    inputLength: getStringLength(args[0]),
                    conversationId: target.conversationId,
                    options: asObjectValue(args[1]) || {}
                }),
                extractResult: (result) => ({ response: result })
            });

            this.configureMethod('runStream', {
                startEvent: AGENT_EVENTS.EXECUTION_START,
                completeEvent: AGENT_EVENTS.EXECUTION_COMPLETE,
                errorEvent: AGENT_EVENTS.EXECUTION_ERROR,
                extractMetadata: (target, methodName, args) => ({
                    inputLength: getStringLength(args[0]),
                    conversationId: target.conversationId,
                    streaming: true,
                    options: asObjectValue(args[1]) || {}
                })
            });
        }

        // Team task assignment methods
        if (this.config.sourceType === 'team') {
            this.configureMethod('assignTask', {
                startEvent: TASK_EVENTS.ASSIGNED,
                completeEvent: TASK_EVENTS.COMPLETED,
                errorEvent: EXECUTION_EVENTS.ERROR,
                extractMetadata: (target, methodName, args) => {
                    const params = asObjectValue(args[0]);
                    return {
                        taskDescription: params?.jobDescription,
                        agentTemplate: params?.agentTemplate,
                        priority: params?.priority,
                        allowFurtherDelegation: params?.allowFurtherDelegation
                    };
                },
                extractResult: (result) => ({
                    result: asObjectValue(result)?.result,
                    agentId: asObjectValue(result)?.agentId,
                    metadata: asObjectValue(result)?.metadata
                })
            });

            this.configureMethod('execute', {
                startEvent: EXECUTION_EVENTS.START,
                completeEvent: EXECUTION_EVENTS.COMPLETE,
                errorEvent: EXECUTION_EVENTS.ERROR,
                extractMetadata: (target, methodName, args) => ({
                    taskDescription: args[0],
                    teamMode: true
                }),
                extractResult: (result) => ({ response: result })
            });
        }

        // Tool execution methods
        if (this.config.sourceType === 'tool') {
            this.configureMethod('execute', {
                startEvent: TOOL_EVENTS.CALL_START,
                completeEvent: TOOL_EVENTS.CALL_COMPLETE,
                errorEvent: TOOL_EVENTS.CALL_ERROR,
                extractMetadata: (target, methodName, args) => ({
                    toolName: asObjectValue(target.schema)?.name || target.constructor.name,
                    parameters: args[0],
                    parametersCount: asObjectValue(args[0]) ? Object.keys(asObjectValue(args[0]) || {}).length : 0,
                    context: args[1]
                }),
                extractResult: (result) => ({
                    result: typeof asObjectValue(result)?.data === 'string'
                        ? asObjectValue(result)?.data || ''
                        : JSON.stringify(asObjectValue(result)?.data),
                    success: asObjectValue(result)?.success
                })
            });
        }

        return this;
    }

    /**
     * Create a proxy wrapper around the target object
     */
    wrap(target: T): T {
        return new Proxy(target, {
            get: (target, prop, receiver) => {
                const originalMethod = Reflect.get(target, prop, receiver);
                if (typeof prop !== 'string') {
                    return originalMethod;
                }
                const methodName = prop;

                // Only wrap methods that are configured
                if (typeof originalMethod === 'function' && this.methodConfigs.has(methodName)) {
                    const methodConfig = this.methodConfigs.get(methodName)!;

                    return async (...args: TExecutionProxyArgs) => {
                        const startTime = Date.now();
                        const executionId = this.generateExecutionId();
                        const proxyTarget = target as TExecutionProxyTarget;

                        try {
                            // Emit start event
                            if (methodConfig.startEvent) {
                                const metadata = methodConfig.extractMetadata?.(proxyTarget, methodName, args) || {};
                                this.emitEvent(methodConfig.startEvent, {
                                    timestamp: new Date(),
                                    metadata: {
                                        ...metadata,
                                        executionId,
                                        methodName,
                                        phase: 'start'
                                    }
                                });
                            }

                            // Execute original method
                            const result = await originalMethod.apply(target, args) as TUniversalValue;
                            const duration = Date.now() - startTime;

                            // Emit complete event
                            if (methodConfig.completeEvent) {
                                const extractedResult = methodConfig.extractResult?.(result) || {};
                                const metadata = methodConfig.extractMetadata?.(proxyTarget, methodName, args) || {};
                                this.emitEvent(methodConfig.completeEvent, {
                                    timestamp: new Date(),
                                    ...extractedResult,
                                    metadata: {
                                        ...metadata,
                                        executionId,
                                        methodName,
                                        duration,
                                        phase: 'complete',
                                        success: true
                                    }
                                });
                            }

                            return result;

                        } catch (error) {
                            const duration = Date.now() - startTime;

                            // Emit error event
                            if (methodConfig.errorEvent) {
                                const metadata = methodConfig.extractMetadata?.(proxyTarget, methodName, args) || {};
                                this.emitEvent(methodConfig.errorEvent, {
                                    timestamp: new Date(),
                                    error: error instanceof Error ? error.message : String(error),
                                    metadata: {
                                        ...metadata,
                                        executionId,
                                        methodName,
                                        duration,
                                        phase: 'error',
                                        errorName: error instanceof Error ? error.name : 'UnknownError',
                                        success: false
                                    }
                                });
                            }

                            throw error;
                        }
                    };
                }

                return originalMethod;
            }
        }) as T;
    }

    /**
     * Emit event with standard ServiceEventData format
     */
    private emitEvent(eventType: string, additionalData: Partial<IBaseEventData>): void {
        const baseMetadata = {
            emitterSourceType: this.config.sourceType,
            emitterSourceId: this.config.sourceId
        };

        const eventData: IBaseEventData = {
            timestamp: new Date(),
            ...(additionalData.metadata ? { metadata: { ...baseMetadata, ...additionalData.metadata } } : { metadata: baseMetadata }),
            ...additionalData
        };

        this.config.eventService.emit(eventType, eventData);
    }

    /**
     * Generate unique execution ID
     */
    private generateExecutionId(): string {
        return `${this.config.sourceType}-${this.config.sourceId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * Factory function to create execution proxy with standard configuration
 */
export function createExecutionProxy<T extends object>(
    target: T,
    config: IExecutionProxyConfig
): T {
    const proxy = new ExecutionProxy<T>(config);
    proxy.configureStandardMethods();
    return proxy.wrap(target);
}

/**
 * Decorator function for automatic event emission
 * Usage: @withEventEmission(eventService, 'agent', 'agent-id')
 */
export function withEventEmission(
    eventService: IEventService,
    sourceType: 'agent' | 'team' | 'tool',
    sourceId: string
) {
    return function <T extends object>(target: T): T {
        return createExecutionProxy(target, {
            eventService,
            sourceType,
            sourceId
        }) as T;
    };
} 