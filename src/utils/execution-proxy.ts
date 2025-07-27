// TODO: Import from '../services/event-service' when building
// import type { EventService, ServiceEventData } from '../services/event-service';

// Temporary local type definitions
type EventService = {
    emit(eventType: string, data: any): void;
};

type ServiceEventData = {
    sourceType: 'agent' | 'team' | 'tool';
    sourceId: string;
    timestamp?: Date;
    [key: string]: any;
};

/**
 * Configuration for execution proxy
 */
export interface ExecutionProxyConfig {
    eventService: EventService;
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
export type MetadataExtractor = (target: any, methodName: string, args: any[]) => Record<string, any>;

/**
 * Method configuration for proxy
 */
export interface MethodConfig {
    startEvent?: string;
    completeEvent?: string;
    errorEvent?: string;
    extractMetadata?: MetadataExtractor;
    extractResult?: (result: any) => any;
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
export class ExecutionProxy<T extends object> {
    private config: ExecutionProxyConfig;
    private methodConfigs: Map<string, MethodConfig> = new Map();

    constructor(config: ExecutionProxyConfig) {
        this.config = config;
    }

    /**
     * Configure specific methods for event emission
     */
    configureMethod(methodName: string, config: MethodConfig): this {
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
                startEvent: 'execution.start',
                completeEvent: 'execution.complete',
                errorEvent: 'execution.error',
                extractMetadata: (target, methodName, args) => ({
                    inputLength: args[0]?.length || 0,
                    conversationId: target.conversationId,
                    options: args[1] || {}
                }),
                extractResult: (result) => ({ response: result })
            });

            this.configureMethod('runStream', {
                startEvent: 'execution.start',
                completeEvent: 'execution.complete',
                errorEvent: 'execution.error',
                extractMetadata: (target, methodName, args) => ({
                    inputLength: args[0]?.length || 0,
                    conversationId: target.conversationId,
                    streaming: true,
                    options: args[1] || {}
                })
            });
        }

        // Team task assignment methods
        if (this.config.sourceType === 'team') {
            this.configureMethod('assignTask', {
                startEvent: 'task.assigned',
                completeEvent: 'task.completed',
                errorEvent: 'execution.error',
                extractMetadata: (target, methodName, args) => {
                    const params = args[0];
                    return {
                        taskDescription: params?.jobDescription,
                        agentTemplate: params?.agentTemplate,
                        priority: params?.priority,
                        allowFurtherDelegation: params?.allowFurtherDelegation
                    };
                },
                extractResult: (result) => ({
                    result: result?.result,
                    agentId: result?.agentId,
                    metadata: result?.metadata
                })
            });

            this.configureMethod('execute', {
                startEvent: 'execution.start',
                completeEvent: 'execution.complete',
                errorEvent: 'execution.error',
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
                startEvent: 'tool_call_start',
                completeEvent: 'tool_call_complete',
                errorEvent: 'tool_call_error',
                extractMetadata: (target, methodName, args) => ({
                    toolName: target.schema?.name || target.constructor.name,
                    parameters: args[0],
                    parametersCount: args[0] ? Object.keys(args[0]).length : 0,
                    context: args[1]
                }),
                extractResult: (result) => ({
                    result: typeof result?.data === 'string' ? result.data : JSON.stringify(result?.data),
                    success: result?.success
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

                // Only wrap methods that are configured
                if (typeof originalMethod === 'function' && this.methodConfigs.has(prop as string)) {
                    const methodConfig = this.methodConfigs.get(prop as string)!;

                    return async (...args: any[]) => {
                        const startTime = Date.now();
                        const executionId = this.generateExecutionId();

                        try {
                            // Emit start event
                            if (methodConfig.startEvent) {
                                const metadata = methodConfig.extractMetadata?.(target, prop as string, args) || {};
                                this.emitEvent(methodConfig.startEvent, {
                                    timestamp: new Date(),
                                    metadata: {
                                        ...metadata,
                                        executionId,
                                        methodName: prop as string,
                                        phase: 'start'
                                    }
                                });
                            }

                            // Execute original method
                            const result = await originalMethod.apply(target, args);
                            const duration = Date.now() - startTime;

                            // Emit complete event
                            if (methodConfig.completeEvent) {
                                const extractedResult = methodConfig.extractResult?.(result) || {};
                                const metadata = methodConfig.extractMetadata?.(target, prop as string, args) || {};
                                this.emitEvent(methodConfig.completeEvent, {
                                    timestamp: new Date(),
                                    ...extractedResult,
                                    metadata: {
                                        ...metadata,
                                        executionId,
                                        methodName: prop as string,
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
                                const metadata = methodConfig.extractMetadata?.(target, prop as string, args) || {};
                                this.emitEvent(methodConfig.errorEvent, {
                                    timestamp: new Date(),
                                    error: error instanceof Error ? error.message : String(error),
                                    metadata: {
                                        ...metadata,
                                        executionId,
                                        methodName: prop as string,
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
        });
    }

    /**
     * Emit event with standard ServiceEventData format
     */
    private emitEvent(eventType: string, additionalData: Partial<ServiceEventData>): void {
        const eventData: ServiceEventData = {
            sourceType: this.config.sourceType,
            sourceId: this.config.sourceId,
            timestamp: new Date(),
            ...additionalData
        };

        this.config.eventService.emit(eventType as any, eventData);
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
    config: ExecutionProxyConfig
): T {
    const proxy = new ExecutionProxy(config);
    return proxy.configureStandardMethods().wrap(target);
}

/**
 * Decorator function for automatic event emission
 * Usage: @withEventEmission(eventService, 'agent', 'agent-id')
 */
export function withEventEmission(
    eventService: EventService,
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