/**
 * @fileoverview Abstract Tool Base Class
 * 
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 * 
 * This is a pure abstract base class that defines the interface and common behavior
 * for all tools. It follows strict architectural principles:
 * 
 * - Depends ONLY on interfaces (EventService interface, not concrete implementations)
 * - Does NOT import concrete classes
 * - Uses Dependency Injection for all dependencies
 * - Handles undefined dependencies gracefully (Null Object Pattern)
 * 
 * Concrete implementations should be handled
 * by the caller who creates the tool instance, not by this abstract class.
 * 
 * @example
 * ```typescript
 * // ✅ CORRECT: Caller prepares an owner-bound EventService and injects it
 * // (Example: bind to the current tool call identity and ownerPath.)
 * const toolEventService = bindWithOwnerPath(baseEventService, {
 *   ownerType: 'tool',
 *   ownerId: toolCallId,
 *   ownerPath,
 *   sourceType: 'tool',
 *   sourceId: toolCallId
 * });
 * const tool = new MyTool({ eventService: toolEventService });
 * 
 * // ❌ WRONG: AbstractTool creates concrete EventService
 * // This violates Dependency Inversion Principle
 * ```
 */

import type { IToolInterface, IToolResult, IToolExecutionContext, IParameterValidationResult, TToolParameters } from '../interfaces/tool';
import type { IToolSchema } from '../interfaces/provider';
import type { AbstractLogger } from '../utils/abstract-logger';
import { DEFAULT_ABSTRACT_LOGGER } from '../utils/abstract-logger';
import type { IEventService } from '../services/event-service';

/**
 * Options for AbstractTool construction
 */
export interface IAbstractToolOptions {
    /**
     * Optional logger for tool operations
     * Defaults to DEFAULT_ABSTRACT_LOGGER if not provided
     */
    logger?: AbstractLogger;

    /**
     * Optional event service for unified event emission
     * If not provided, tool will operate silently without emitting events
     * 
     * The caller should provide an EventService configured with appropriate settings
     * (e.g., ownerPrefix='tool' for tool events)
     * 
     * @since 2.1.0
     */
    eventService?: IEventService;
}

/**
 * Tool execution function type with proper parameter constraints
 */
export type TToolExecutionFunction<TParams = TToolParameters, TResult = IToolResult> = (
    parameters: TParams
) => Promise<TResult> | TResult;

/**
 * Abstract tool interface with type parameters for enhanced type safety
 * 
 * @template TParams - Tool parameters type (defaults to AbstractToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)  
 */
export interface IAbstractToolInterface<TParams = TToolParameters, TResult = IToolResult> {
    name: string;
    description: string;
    parameters: IToolSchema['parameters'];
    execute: TToolExecutionFunction<TParams, TResult>;
}

/**
 * Type-safe tool interface with type parameters
 * 
 * @template TParameters - Tool parameters type (defaults to AbstractToolParameters for backward compatibility)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export interface ITypeSafeToolInterface<TParameters = TToolParameters, TResult = IToolResult> {
    readonly schema: IToolSchema;
    execute(parameters: TParameters, context: IToolExecutionContext): Promise<TResult>;
    validate(parameters: TParameters): boolean;
    validateParameters(parameters: TParameters): IParameterValidationResult;
    getDescription(): string;
    getName(): string;
}

/**
 * Abstract base class for tools with type parameter support
 * Provides type-safe parameter handling and result processing
 * 
 * 🎯 ARCHITECTURAL PRINCIPLES:
 * - Pure abstract class - depends only on interfaces
 * - No concrete class dependencies (EventService interface only)
 * - Dependency Injection for all external dependencies
 * - Graceful degradation (undefined dependencies = silent operation)
 * 
 * @template TParameters - Tool parameters type (defaults to TToolParameters)
 * @template TResult - Tool result type (defaults to ToolResult for backward compatibility)
 */
export abstract class AbstractTool<TParameters = TToolParameters, TResult = IToolResult>
    implements ITypeSafeToolInterface<TParameters, TResult> {

    abstract readonly schema: IToolSchema;

    /**
     * Logger for tool operations
     */
    protected readonly logger: AbstractLogger;

    /**
     * EventService for direct event emission (optional)
     * If undefined, tool operates silently without emitting events
     */
    private eventService: IEventService | undefined;

    /**
     * Constructor with simplified options
     * 
     * 🎯 DEPENDENCY INJECTION:
     * All dependencies are injected via options parameter
     * No concrete classes are instantiated within this constructor
     * 
     * @param options - Configuration options for the tool
     */
    constructor(options: IAbstractToolOptions = {}) {
        // Accept eventService as-is (no wrapping, no transformation)
        // Caller is responsible for providing properly configured EventService
        this.eventService = options.eventService;
        this.logger = options.logger ?? DEFAULT_ABSTRACT_LOGGER;
    }

    /**
     * Set EventService for post-construction injection
     * 
     * 🎯 DEPENDENCY INJECTION:
     * Accepts EventService as-is without transformation
     * Caller is responsible for providing properly configured EventService
     * 
     * @param eventService - EventService instance to use for event emission (or undefined for silent operation)
     */
    setEventService(eventService: IEventService | undefined): void {
        this.eventService = eventService;
    }

    /**
     * Get current EventService (for testing/inspection)
     */
    protected getEventService(): IEventService | undefined {
        return this.eventService;
    }

    /**
     * Emit event through EventService (if available)
     * If EventService is not available, silently ignores the event (Null Object Pattern)
     * 
     * @param eventType - Type of event to emit
     * @param data - Event data
     */
    protected emitEvent(eventType: string, data: any): void {
        if (!this.eventService) {
            // Silent operation - no EventService available
            return;
        }
        this.eventService.emit(eventType, data);
    }

    /**
     * Execute tool with simplified lifecycle
     * @param parameters - Tool parameters
     * @param context - Optional execution context
     * @returns Promise resolving to tool result
     */
    async execute(parameters: TParameters, context: IToolExecutionContext): Promise<TResult> {
        return await this.executeImpl(parameters, context);
    }

    /**
     * Concrete implementation of tool execution
     * This method should be implemented by subclasses to provide actual tool logic
     * 
     * @param parameters - Tool parameters
     * @param context - Optional execution context
     * @returns Promise resolving to tool result
     */
    protected abstract executeImpl(parameters: TParameters, context: IToolExecutionContext): Promise<TResult>;

    validate(parameters: TParameters): boolean {
        const required = this.schema.parameters.required || [];
        return required.every(field => field in (parameters as Record<string, string | number | boolean>));
    }

    /**
     * Validate tool parameters with detailed result (default implementation)
     */
    validateParameters(parameters: TParameters): IParameterValidationResult {
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
 * @deprecated Use AbstractTool with type parameters instead
 */
export abstract class LegacyAbstractTool extends AbstractTool<TToolParameters, IToolResult> implements IToolInterface { }

