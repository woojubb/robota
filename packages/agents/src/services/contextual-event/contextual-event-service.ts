/**
 * ContextualEventService - The new standard EventService implementation
 * 
 * This service provides hierarchical context management for events,
 * allowing parent-child relationships and automatic context propagation.
 * 
 * Key features:
 * - Automatic context inheritance from parent to child
 * - Hierarchical execution tracking
 * - Clean factory method for creating child instances
 * - Full compatibility with existing EventService interface
 */

import { SilentLogger } from '../../utils/simple-logger.js';
import type { SimpleLogger } from '../../utils/simple-logger.js';
import type { ServiceEventType, ServiceEventData } from '../event-service.js';
import type {
    EventServiceCreationContext,
    InternalExecutionContext,
    ContextualEventServiceInterface,
    ContextualEventData,
    ContextualEventServiceConfig,
    ContextExtractor
} from './types.js';

export class ContextualEventService implements ContextualEventServiceInterface {
    private readonly baseEventService: ContextualEventServiceInterface;
    private readonly logger: SimpleLogger;
    private readonly executionContext?: InternalExecutionContext;
    private readonly config: Required<ContextualEventServiceConfig>;
    private readonly contextExtractors: ContextExtractor[];

    constructor(
        baseEventService?: ContextualEventServiceInterface,
        logger?: SimpleLogger,
        executionContext?: EventServiceCreationContext,
        config?: Partial<ContextualEventServiceConfig>
    );
    constructor(config: ContextualEventServiceConfig);
    constructor(
        baseEventServiceOrConfig?: ContextualEventServiceInterface | ContextualEventServiceConfig,
        logger?: SimpleLogger,
        executionContext?: EventServiceCreationContext,
        config?: Partial<ContextualEventServiceConfig>
    ) {
        // 🎯 Handle config-first constructor pattern
        if (baseEventServiceOrConfig && typeof baseEventServiceOrConfig === 'object' &&
            !('emit' in baseEventServiceOrConfig)) {
            // First argument is config object
            const fullConfig = baseEventServiceOrConfig as ContextualEventServiceConfig;
            this.baseEventService = fullConfig.baseEventService || new SilentContextualEventService();
            this.logger = fullConfig.logger || SilentLogger;
            this.contextExtractors = fullConfig.contextExtractors || [];

            this.config = {
                baseEventService: this.baseEventService,
                logger: this.logger,
                executionContext: fullConfig.executionContext as any, // TODO: Fix type compatibility
                contextExtractors: this.contextExtractors,
                autoInjectContext: true,
                preserveEventTimestamp: true,
                enableHierarchyTracking: true,
                ...fullConfig
            };

            if (fullConfig.executionContext) {
                this.executionContext = this.buildInternalContext(fullConfig.executionContext);
            }
        } else {
            // Legacy constructor pattern
            this.baseEventService = (baseEventServiceOrConfig as ContextualEventServiceInterface) || new SilentContextualEventService();
            this.logger = logger || SilentLogger;
            this.contextExtractors = config?.contextExtractors || [];

            this.config = {
                baseEventService: this.baseEventService,
                logger: this.logger,
                executionContext: executionContext as any, // TODO: Fix type compatibility
                contextExtractors: this.contextExtractors,
                autoInjectContext: true,
                preserveEventTimestamp: true,
                enableHierarchyTracking: true,
                ...config
            };

            if (executionContext) {
                this.executionContext = this.buildInternalContext(executionContext);
            }
        }
    }

    /**
     * 🎯 Core EventService method - emit events with automatic context injection
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        try {
            // 🎯 Prepare enhanced event data with context
            const enhancedData = this.enhanceEventData(data);

            // 📊 Log the event emission
            this.logger.debug(`[ContextualEventService] Emitting event: ${eventType}`, {
                executionId: this.executionContext?.executionId,
                sourceType: enhancedData.sourceType,
                sourceId: enhancedData.sourceId,
                parentExecutionId: enhancedData.parentExecutionId
            });

            // 🔄 Delegate to base EventService
            // Ensure sourceType is valid before passing to base service
            const validSourceType: 'agent' | 'team' | 'tool' =
                (enhancedData.sourceType === 'agent' || enhancedData.sourceType === 'team' || enhancedData.sourceType === 'tool')
                    ? enhancedData.sourceType
                    : 'agent';

            const validatedData = {
                ...enhancedData,
                sourceType: validSourceType
            };
            this.baseEventService.emit(eventType, validatedData as any); // TODO: Fix type compatibility

        } catch (error) {
            this.logger.error(`[ContextualEventService] Error emitting event ${eventType}:`, error);
            throw error;
        }
    }

    /**
     * 📊 Track execution hierarchy
     */
    trackExecution(executionId: string, parentExecutionId?: string, level?: number): void {
        try {
            this.logger.debug(`[ContextualEventService] Tracking execution: ${executionId}`, {
                parentExecutionId,
                level,
                currentContext: this.executionContext?.executionId
            });

            // 🔄 Delegate to base EventService if it supports tracking
            if (this.baseEventService.trackExecution) {
                this.baseEventService.trackExecution(executionId, parentExecutionId, level);
            }

        } catch (error) {
            this.logger.error(`[ContextualEventService] Error tracking execution ${executionId}:`, error);
            throw error;
        }
    }

    /**
     * 🔗 Create bound emit function for specific execution context
     */
    createBoundEmit(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void {
        return (eventType: ServiceEventType, data: ServiceEventData) => {
            // 🎯 Inject execution context into the event data
            const boundData: ServiceEventData = {
                ...data,
                executionId: executionId,
                parentExecutionId: this.executionContext?.executionId,
                rootExecutionId: this.executionContext?.rootExecutionId || this.executionContext?.executionId
            };

            this.emit(eventType, boundData);
        };
    }

    /**
     * 🏭 Factory method - Create child EventService with inherited context
     * This is the key method that replaces all the complex factory logic
     */
    createChild(childContext: EventServiceCreationContext): ContextualEventServiceInterface;
    createChild(sourceObject: unknown): ContextualEventServiceInterface;
    createChild(childContextOrSource: EventServiceCreationContext | unknown): ContextualEventServiceInterface {
        try {
            // 🎯 Determine if this is explicit context or source object
            let childContext: EventServiceCreationContext;

            if (this.isEventServiceCreationContext(childContextOrSource)) {
                // Explicit context provided
                childContext = childContextOrSource;
            } else {
                // Source object provided - extract context using extractors
                childContext = this.extractContextFromSource(childContextOrSource);
            }

            // 🏗️ Build new execution context inheriting from parent
            const newExecutionContext = this.buildChildContext(childContext);

            this.logger.debug(`[ContextualEventService] Creating child EventService`, {
                parentExecutionId: this.executionContext?.executionId,
                childExecutionId: newExecutionContext.executionId,
                childSourceType: newExecutionContext.sourceType
            });

            // 🆕 Create new ContextualEventService with inherited context and extractors
            return new ContextualEventService(
                this.baseEventService, // Share the same base EventService
                childContext.logger || this.logger, // Use provided logger or inherit
                newExecutionContext, // New execution context
                {
                    ...this.config,
                    contextExtractors: this.contextExtractors // Inherit extractors
                }
            );

        } catch (error) {
            this.logger.error(`[ContextualEventService] Error creating child:`, error);
            throw error;
        }
    }

    /**
     * 📊 Get current execution context (for debugging)
     */
    getExecutionContext(): InternalExecutionContext | undefined {
        return this.executionContext;
    }

    /**
     * 🌳 Get full context hierarchy (for debugging)
     */
    getContextHierarchy(): InternalExecutionContext[] {
        const hierarchy: InternalExecutionContext[] = [];

        if (this.executionContext) {
            hierarchy.push(this.executionContext);
        }

        // 🔄 Get parent hierarchy if base service supports it
        if (this.baseEventService.getContextHierarchy) {
            hierarchy.unshift(...this.baseEventService.getContextHierarchy());
        }

        return hierarchy;
    }

    // 🔧 Private helper methods

    /**
     * Build internal execution context from creation context
     */
    private buildInternalContext(context: EventServiceCreationContext): InternalExecutionContext {
        const now = new Date();

        return {
            executionId: context.executionId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            parentExecutionId: context.parentExecutionId,
            rootExecutionId: context.rootExecutionId || context.parentExecutionId,
            executionLevel: context.executionLevel ?? 1, // Use nullish coalescing to allow 0
            executionPath: context.executionPath || [],
            sourceType: context.sourceType || 'unknown',
            sourceId: context.sourceId || 'unknown',
            toolName: context.toolName,
            parameters: context.parameters,
            metadata: context.metadata,
            createdAt: now
        };
    }

    /**
     * Build child context inheriting from parent
     */
    private buildChildContext(childContext: EventServiceCreationContext): InternalExecutionContext {
        const now = new Date();
        const parentContext = this.executionContext;

        // 🧬 Generate unique execution ID for child
        const childExecutionId = childContext.executionId ||
            `${parentContext?.executionId || 'root'}_child_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return {
            executionId: childExecutionId,
            parentExecutionId: parentContext?.executionId,
            rootExecutionId: parentContext?.rootExecutionId || parentContext?.executionId,
            executionLevel: (parentContext?.executionLevel || 0) + 1,
            executionPath: [
                ...(parentContext?.executionPath || []),
                childExecutionId
            ],
            sourceType: childContext.sourceType || 'unknown',
            sourceId: childContext.sourceId || childExecutionId,
            toolName: childContext.toolName,
            parameters: childContext.parameters,
            metadata: {
                ...parentContext?.metadata,
                ...childContext.metadata
            },
            createdAt: now
        };
    }

    /**
     * Enhance event data with automatic context injection
     */
    private enhanceEventData(data: ServiceEventData): ContextualEventData {
        if (!this.config.autoInjectContext || !this.executionContext) {
            return data;
        }

        // 🎯 Preserve original timestamp from EventService (rule compliance)
        const enhancedData: ContextualEventData = {
            ...data,
            executionId: (data.executionId || this.executionContext.executionId || 'unknown') as string,
            parentExecutionId: data.parentExecutionId || this.executionContext.parentExecutionId,
            rootExecutionId: data.rootExecutionId || this.executionContext.rootExecutionId,
            executionLevel: data.executionLevel ?? this.executionContext.executionLevel,
            executionPath: data.executionPath || this.executionContext.executionPath,
            sourceType: data.sourceType || this.executionContext.sourceType || 'agent',
            sourceId: data.sourceId || this.executionContext.sourceId || 'unknown',
            toolName: data.toolName || this.executionContext.toolName
        };

        // 🕒 Preserve original timestamp if it exists (don't override)
        if (this.config.preserveEventTimestamp && !data.timestamp) {
            enhancedData.timestamp = new Date(); // Only set if not already provided
        }

        return enhancedData;
    }

    /**
     * Type guard to check if object is EventServiceCreationContext
     */
    private isEventServiceCreationContext(obj: unknown): obj is EventServiceCreationContext {
        return typeof obj === 'object' && obj !== null &&
            (obj as any).executionId !== undefined ||
            (obj as any).sourceType !== undefined ||
            (obj as any).sourceId !== undefined;
    }

    /**
     * 🎯 Extract context from source object using registered extractors
     */
    private extractContextFromSource(sourceObject: unknown): EventServiceCreationContext {
        // 🔍 Try each extractor in order until one succeeds
        for (const extractor of this.contextExtractors) {
            // Check type matching first
            if (extractor.ctor) {
                if (sourceObject instanceof extractor.ctor) {
                    const context = extractor.extract(sourceObject);
                    if (context) {
                        this.logger.debug(`[ContextualEventService] Context extracted using constructor match`, {
                            constructor: extractor.ctor.name,
                            sourceType: context.sourceType
                        });
                        return context;
                    }
                }
            } else if (extractor.name) {
                if (sourceObject &&
                    typeof sourceObject === 'object' &&
                    sourceObject.constructor?.name === extractor.name) {
                    const context = extractor.extract(sourceObject);
                    if (context) {
                        this.logger.debug(`[ContextualEventService] Context extracted using name match`, {
                            name: extractor.name,
                            sourceType: context.sourceType
                        });
                        return context;
                    }
                }
            } else {
                // No matching criteria - try the extractor directly
                const context = extractor.extract(sourceObject);
                if (context) {
                    this.logger.debug(`[ContextualEventService] Context extracted using direct extraction`, {
                        sourceType: context.sourceType
                    });
                    return context;
                }
            }
        }

        // 🚨 No extractor could handle this source object
        this.logger.warn(`[ContextualEventService] No context extractor found for source object`, {
            objectType: sourceObject?.constructor?.name || typeof sourceObject,
            availableExtractors: this.contextExtractors.length
        });

        // Return a minimal default context
        return {
            executionId: `unknown_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sourceType: 'unknown',
            sourceId: 'unknown'
        };
    }
}

/**
 * 🔇 Silent implementation of ContextualEventService for testing/fallback
 */
export class SilentContextualEventService implements ContextualEventServiceInterface {
    emit(): void {
        // Silent - do nothing
    }

    trackExecution(): void {
        // Silent - do nothing
    }

    createBoundEmit(): (eventType: ServiceEventType, data: ServiceEventData) => void {
        return () => {
            // Silent - do nothing
        };
    }

    createChild(childContext: EventServiceCreationContext): ContextualEventServiceInterface;
    createChild(sourceObject: unknown): ContextualEventServiceInterface;
    createChild(childContextOrSource: EventServiceCreationContext | unknown): ContextualEventServiceInterface {
        // Return a new silent instance regardless of input
        return new SilentContextualEventService();
    }

    getExecutionContext(): undefined {
        return undefined;
    }

    getContextHierarchy(): InternalExecutionContext[] {
        return [];
    }
}
