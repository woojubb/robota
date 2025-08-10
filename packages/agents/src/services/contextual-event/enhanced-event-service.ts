/**
 * Enhanced EventService Interface
 * 
 * ⚠️ MIGRATION ONLY - DELETE AFTER MIGRATION COMPLETE ⚠️
 * 
 * This file extends the original EventService interface to include
 * the new createChild method, making it forward-compatible during migration.
 * 
 * Once ContextualEventService becomes the standard EventService,
 * this entire file MUST BE DELETED.
 * 
 * Migration plan:
 * 1. Replace ActionTrackingEventService with ContextualEventService
 * 2. Update all EventService usages to ContextualEventService directly
 * 3. Delete this entire enhanced-event-service.ts file
 * 
 * @deprecated Will be removed after migration is complete
 */

import type { ServiceEventType, ServiceEventData } from '../event-service.js';
import type { EventServiceCreationContext } from './types.js';

/**
 * Enhanced EventService interface with contextual capabilities
 * This extends the original EventService with the createChild method
 */
export interface EnhancedEventService {
    // 🎯 Original EventService methods
    emit(eventType: ServiceEventType, data: ServiceEventData): void;

    // 📊 Optional methods (may not be present in all implementations)
    trackExecution?(executionId: string, parentExecutionId?: string, level?: number): void;
    createBoundEmit?(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void;

    // 🆕 New contextual capability - the key method
    createChild(childContext: EventServiceCreationContext): EnhancedEventService;
}

/**
 * Type guard to check if an EventService supports createChild
 */
export function supportsCreateChild(eventService: any): eventService is EnhancedEventService {
    return eventService && typeof eventService.createChild === 'function';
}

/**
 * Type guard to check if an EventService supports context tracking
 */
export function supportsContextTracking(eventService: any): eventService is EnhancedEventService & {
    trackExecution: (executionId: string, parentExecutionId?: string, level?: number) => void;
    createBoundEmit: (executionId: string) => (eventType: ServiceEventType, data: ServiceEventData) => void;
} {
    return eventService &&
        typeof eventService.trackExecution === 'function' &&
        typeof eventService.createBoundEmit === 'function';
}

/**
 * Helper function to safely create a child EventService
 * 
 * ⚠️ MIGRATION ONLY - DELETE AFTER MIGRATION COMPLETE ⚠️
 * 
 * Falls back to creating a new instance if createChild is not supported.
 * Once all EventService instances support createChild, this becomes unnecessary.
 * 
 * @deprecated Will be removed after migration is complete
 */
export function safeCreateChild(
    eventService: any,
    childContext: EventServiceCreationContext
): EnhancedEventService {
    if (supportsCreateChild(eventService)) {
        return eventService.createChild(childContext);
    }
    
    // 🔄 Fallback: Import and create ContextualEventService
    // This ensures compatibility with older EventService implementations
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ContextualEventService } = require('./contextual-event-service.js');
    return new ContextualEventService(eventService, undefined, childContext);
}

/**
 * Migration utility to upgrade an existing EventService to EnhancedEventService
 * 
 * ⚠️ MIGRATION ONLY - DELETE AFTER MIGRATION COMPLETE ⚠️
 * 
 * This can be used to gradually migrate from old EventService to new one.
 * Once migration is complete, all EventService instances will be ContextualEventService.
 * 
 * @deprecated Will be removed after migration is complete
 */
export function upgradeEventService(
    existingEventService: any,
    context?: EventServiceCreationContext
): EnhancedEventService {
    // If already enhanced, return as-is
    if (supportsCreateChild(existingEventService)) {
        return existingEventService as EnhancedEventService;
    }
    
    // 🔄 Wrap in ContextualEventService
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ContextualEventService } = require('./contextual-event-service.js');
    return new ContextualEventService(existingEventService, undefined, context);
}
