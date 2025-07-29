import type { ToolInterface, ToolResult, ToolExecutionContext, ParameterValidationResult } from '../interfaces/tool';
import type { ToolSchema } from '../interfaces/provider';
import type { SimpleLogger } from '../utils/simple-logger';
import { SilentLogger } from '../utils/simple-logger';
import type { EventService } from '../services/event-service';
import { EventServiceHookFactory } from '../utils/event-service-hook-factory';

/**
 * Hook interface for tool execution lifecycle
 * Provides extension points for monitoring, logging, and custom logic
 */
export interface ToolHooks {
    /**
     * Called before tool execution
     * @param toolName - Name of the tool being executed
     * @param parameters - Parameters passed to the tool
     * @param context - Optional execution context
     */
    beforeExecute?(toolName: string, parameters: any, context?: ToolExecutionContext): Promise<void> | void;

    /**
     * Called after successful tool execution
     * @param toolName - Name of the tool that was executed
     * @param parameters - Parameters that were passed to the tool
     * @param result - Result returned by the tool
     * @param context - Optional execution context
     */
    afterExecute?(toolName: string, parameters: any, result: any, context?: ToolExecutionContext): Promise<void> | void;

    /**
     * Called when tool execution throws an error
     * @param toolName - Name of the tool that failed
     * @param parameters - Parameters that were passed to the tool
     * @param error - Error that was thrown
     * @param context - Optional execution context
     */
    onError?(toolName: string, parameters: any, error: Error, context?: ToolExecutionContext): Promise<void> | void;
}

/**
 * Options for BaseTool construction
 * Supports dependency injection for hooks and logging
 */
export interface BaseToolOptions {
    /**
     * Optional hooks for tool execution lifecycle
     */
    hooks?: ToolHooks;

    /**
     * Optional logger for tool operations
     * Defaults to SilentLogger if not provided
     */
    logger?: SimpleLogger;

    /**
     * Optional event service for unified event emission
     * If provided and hooks are not provided, will automatically create hooks using EventServiceHookFactory
     * @since 2.1.0
     */
    eventService?: EventService;
}

/**
 * Base tool parameters type - extended for full ToolParameters compatibility
 * Used for parameter validation and execution in base tool context
 * 
 * REASON: Extended to include all ToolParameterValue types for complete compatibility
 * ALTERNATIVES_CONSIDERED: 
 * 1. Keep narrow type and use type assertions everywhere (increases maintenance burden)
 * 2. Create separate conversion functions (adds complexity without benefit)
 * 3. Use intersection types (unnecessary complexity for this use case)
 * 4. Modify ToolParameters to remove complex types (breaks existing APIs)
 * 5. Create type conversion utilities (adds runtime overhead)
 * TODO: Monitor usage patterns and consider narrowing if complex types cause runtime issues
 */
export type BaseToolParameters = Record<string,
    | string
    | number
    | boolean
    | string[]
    | number[]
    | boolean[]
    | Array<string | number | boolean>
    | Record<string, string | number | boolean>
    | null
    | undefined
>;

/**
 * Tool execution function type with proper parameter constraints
 */
export type ToolExecutionFunction<TParams = BaseToolParameters, TResult = ToolResult> = (
    parameters: TParams
) => Promise<TResult> | TResult;

/**
 * Base tool interface with type parameters for enhanced type safety
 * 
 * @template TParams - Tool parameters type (defaults to BaseToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)  
 */
export interface BaseToolInterface<TParams = BaseToolParameters, TResult = ToolResult> {
    name: string;
    description: string;
    parameters: ToolSchema['parameters'];
    execute: ToolExecutionFunction<TParams, TResult>;
}

/**
 * Type-safe tool interface with type parameters
 * 
 * @template TParameters - Tool parameters type (defaults to BaseToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export interface TypeSafeToolInterface<TParameters = BaseToolParameters, TResult = ToolResult> {
    readonly schema: ToolSchema;
    execute(parameters: TParameters, context?: ToolExecutionContext): Promise<TResult>;
    validate(parameters: TParameters): boolean;
    validateParameters(parameters: TParameters): ParameterValidationResult;
    getDescription(): string;
    getName(): string;
}

/**
 * Base abstract class for tools with type parameter support
 * Provides type-safe parameter handling and result processing
 * 
 * @template TParameters - Tool parameters type (defaults to BaseToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export abstract class BaseTool<TParameters = BaseToolParameters, TResult = ToolResult>
    implements TypeSafeToolInterface<TParameters, TResult> {

    abstract readonly schema: ToolSchema;

    /**
     * Optional hooks for tool execution lifecycle
     */
    protected readonly hooks: ToolHooks | undefined;

    /**
     * Logger for tool operations
     */
    protected readonly logger: SimpleLogger;

    /**
     * Enhanced EventService for automatic hierarchy tracking (if available)
     */
    private enhancedEventService: EventService | undefined;

    /**
     * Constructor with optional hook and logger support
     * @param options - Configuration options for the tool
     */
    constructor(options: BaseToolOptions = {}) {
        // Always store Enhanced EventService if available, regardless of hooks
        this.enhancedEventService = options.eventService;

        // If eventService is provided and hooks are not, create hooks automatically
        if (options.eventService && !options.hooks) {
            this.hooks = EventServiceHookFactory.createToolHooks(
                options.eventService,
                options.eventService ? `tool-${this.constructor.name}` : 'unknown-tool'
            );
        } else {
            this.hooks = options.hooks;
        }

        this.logger = options.logger || SilentLogger;
    }

    /**
     * Set EventService and auto-generate ToolHooks if not already set
     * This allows for post-construction EventService injection
     * 
     * @param eventService - EventService instance to use for event emission
     */
    setEventService(eventService: EventService): void {
        // Always store Enhanced EventService for hierarchy tracking
        this.enhancedEventService = eventService;

        // Only set hooks if they're not already configured
        if (!this.hooks && eventService) {
            // Use Object.defineProperty to set the readonly property
            Object.defineProperty(this, 'hooks', {
                value: EventServiceHookFactory.createToolHooks(
                    eventService,
                    `tool-${this.constructor.name}`
                ),
                writable: false,
                enumerable: true,
                configurable: false
            });
        }
    }

    /**
     * Template Method Pattern: Execute tool with hook support
     * This method coordinates the execution lifecycle and should not be overridden
     * 
     * @param parameters - Tool parameters
     * @param context - Optional execution context
     * @returns Promise resolving to tool result
     */
    async execute(parameters: TParameters, context?: ToolExecutionContext): Promise<TResult> {
        const toolName = this.schema.name || this.constructor.name;
        // Generate execution ID - prioritize context.executionId from ToolExecutionService
        const executionId = context?.executionId || `${toolName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // 🔥 Enhanced EventService Duck Typing - but don't register hierarchy here
        // ToolExecutionService already registers the hierarchy with proper parent relationships
        if (this.enhancedEventService && typeof (this.enhancedEventService as any).trackExecution === 'function') {
            try {
                this.logger.debug('🎯 Enhanced EventService detected in BaseTool - using existing hierarchy', {
                    toolName,
                    executionId,
                    contextExecutionId: context?.executionId,
                    hasParentId: !!context?.parentExecutionId,
                    parentId: context?.parentExecutionId,
                    executionLevel: context?.executionLevel
                });

                // Don't call trackExecution here - ToolExecutionService already did it
                // Just get the bound emit function if available
                if (typeof (this.enhancedEventService as any).createBoundEmit === 'function') {
                    const boundEmit = (this.enhancedEventService as any).createBoundEmit(executionId);
                    if (context) {
                        (context as any).boundEmit = boundEmit;
                        this.logger.debug('✅ BaseTool bound emit function attached to context', {
                            toolName,
                            executionId,
                            hasBoundEmit: typeof boundEmit === 'function'
                        });
                    }
                }
            } catch (error) {
                this.logger.warn('❌ Enhanced EventService integration failed in BaseTool', {
                    toolName,
                    executionId,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else {
            this.logger.debug('⚠️ Enhanced EventService not detected in BaseTool', {
                toolName,
                executionId,
                hasEnhancedEventService: !!this.enhancedEventService,
                hasTrackExecution: this.enhancedEventService && typeof (this.enhancedEventService as any).trackExecution === 'function'
            });
        }

        try {
            // 🟢 Pre-execution hook
            await this.hooks?.beforeExecute?.(toolName, parameters, context);

            this.logger.debug(`Executing tool: ${toolName}`, { parameters });

            // 🟢 Delegate to concrete implementation
            const result = await this.executeImpl(parameters, context);

            this.logger.debug(`Tool execution completed: ${toolName}`, { result });

            // 🟢 Post-execution hook
            await this.hooks?.afterExecute?.(toolName, parameters, result, context);

            return result;
        } catch (error) {
            this.logger.error(`Tool execution failed: ${toolName}`, { error: error instanceof Error ? error.message : error, parameters });

            // 🟢 Error hook
            await this.hooks?.onError?.(toolName, parameters, error as Error, context);

            throw error;
        }
    }

    /**
     * Concrete implementation of tool execution
     * This method should be implemented by subclasses to provide actual tool logic
     * 
     * @param parameters - Tool parameters
     * @param context - Optional execution context
     * @returns Promise resolving to tool result
     */
    protected abstract executeImpl(parameters: TParameters, context?: ToolExecutionContext): Promise<TResult>;

    validate(parameters: TParameters): boolean {
        const required = this.schema.parameters.required || [];
        return required.every(field => field in (parameters as Record<string, string | number | boolean>));
    }

    /**
     * Validate tool parameters with detailed result (default implementation)
     */
    validateParameters(parameters: TParameters): ParameterValidationResult {
        const required = this.schema.parameters.required || [];
        const errors: string[] = [];
        const paramObj = parameters as Record<string, string | number | boolean>;

        for (const field of required) {
            if (!(field in paramObj)) {
                errors.push(`Missing required parameter: ${field}`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    getDescription(): string {
        return this.schema.description;
    }

    getName(): string {
        return this.schema.name;
    }
}

/**
 * Legacy tool class for backward compatibility
 * @deprecated Use BaseTool with type parameters instead
 */
export abstract class LegacyBaseTool extends BaseTool<BaseToolParameters, ToolResult> implements ToolInterface { } 