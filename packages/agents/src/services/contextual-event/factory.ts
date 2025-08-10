/**
 * Simplified ContextualEventService Factory
 * 
 * Provides only essential factory methods without domain-specific complexity.
 * Follows domain neutrality principles - no third-party tool references.
 */

import { SilentLogger } from '../../utils/simple-logger.js';
import type { SimpleLogger } from '../../utils/simple-logger.js';
import { ContextualEventService, SilentContextualEventService } from './contextual-event-service.js';
import type {
    EventServiceCreationContext,
    ContextualEventServiceInterface,
    ContextualEventServiceConfig
} from './types.js';

export class ContextualEventServiceFactory {
    /**
     * 🏭 Create a new ContextualEventService
     * This is the main factory method - covers 90% of use cases
     */
    static create(
        context?: EventServiceCreationContext,
        logger?: SimpleLogger,
        config?: Partial<ContextualEventServiceConfig>
    ): ContextualEventServiceInterface {
        return new ContextualEventService(
            undefined, // No base service - create fresh
            logger || SilentLogger,
            context,
            config
        );
    }

    /**
     * 🔄 Wrap an existing EventService
     * 
     * ⚠️ MIGRATION ONLY - DELETE AFTER MIGRATION COMPLETE ⚠️
     * 
     * This method is ONLY for migrating from old EventService implementations
     * to ContextualEventService. Once all existing EventService instances are
     * migrated to ContextualEventService, this method MUST BE DELETED.
     * 
     * Migration plan:
     * 1. Replace ActionTrackingEventService with ContextualEventService
     * 2. Update all EventService creation sites to use ContextualEventService.create()
     * 3. Remove this wrap() method entirely
     * 
     * @deprecated Will be removed after migration is complete
     */
    static wrap(
        existingEventService: any,
        context?: EventServiceCreationContext,
        logger?: SimpleLogger
    ): ContextualEventServiceInterface {
        // If it's already a ContextualEventService, return as-is
        if (existingEventService instanceof ContextualEventService) {
            return existingEventService;
        }

        // Wrap any existing EventService to add contextual capabilities
        return new ContextualEventService(
            existingEventService,
            logger || SilentLogger,
            context
        );
    }
}

/**
 * 🎯 Convenience helper functions for common patterns
 * Domain-neutral utilities for EventService management
 */
export class ContextualEventServiceHelpers {
    /**
     * Generate a unique execution ID
     */
    static generateExecutionId(prefix?: string): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return prefix ? `${prefix}_${timestamp}_${random}` : `exec_${timestamp}_${random}`;
    }

    /**
     * Create child with generated execution ID
     * Useful when you need a unique ID but don't want to generate it manually
     */
    static createChildWithGeneratedId(
        parentService: ContextualEventServiceInterface,
        context: Omit<EventServiceCreationContext, 'executionId'> & { executionIdPrefix?: string }
    ): ContextualEventServiceInterface {
        const { executionIdPrefix, ...restContext } = context;

        return parentService.createChild({
            ...restContext,
            executionId: ContextualEventServiceHelpers.generateExecutionId(executionIdPrefix)
        });
    }

        /**
     * Safe child creation with fallback to new instance
     * 
     * ⚠️ MIGRATION ONLY - DELETE AFTER MIGRATION COMPLETE ⚠️
     * 
     * This method handles cases where parent might not support createChild.
     * Once all EventService instances are ContextualEventService (which always
     * supports createChild), this method becomes unnecessary and MUST BE DELETED.
     * 
     * Migration plan:
     * 1. Replace all EventService instances with ContextualEventService
     * 2. Use direct parent.createChild() instead of safeCreateChild()
     * 3. Remove this safeCreateChild() method entirely
     * 
     * @deprecated Will be removed after migration is complete
     */
    static safeCreateChild(
        parentService: any,
        context: EventServiceCreationContext,
        logger?: SimpleLogger
    ): ContextualEventServiceInterface {
        // If parent supports createChild, use it
        if (parentService && typeof parentService.createChild === 'function') {
            return parentService.createChild(context);
        }
        
        // Otherwise create new instance
        return ContextualEventServiceFactory.create(context, logger);
    }

    /**
     * Create root EventService for top-level components
     * Used by ExecutionService, Team, or other root-level services
     */
    static createRoot(
        rootId: string,
        sourceType: string,
        logger?: SimpleLogger
    ): ContextualEventServiceInterface {
        return ContextualEventServiceFactory.create({
            executionId: rootId,
            sourceType: sourceType,
            sourceId: rootId,
            executionLevel: 0 // Root level
        }, logger);
    }

    /**
     * Create execution-scoped EventService
     * Used when ExecutionService needs to create EventService for tool execution, etc.
     */
    static createExecutionScoped(
        parentService: ContextualEventServiceInterface,
        phase: string,
        metadata?: Record<string, unknown>
    ): ContextualEventServiceInterface {
        return parentService.createChild({
            executionId: ContextualEventServiceHelpers.generateExecutionId(phase),
            sourceType: 'execution',
            sourceId: parentService.getExecutionContext()?.sourceId || 'unknown',
            executionLevel: 2, // Execution level
            metadata: {
                phase: phase,
                ...metadata
            }
        });
    }
}
