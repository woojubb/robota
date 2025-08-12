/**
 * ContextualEventService Package - Main Exports
 * 
 * This package provides the new standard EventService implementation
 * with hierarchical context management and clean factory patterns.
 * 
 * @packageDocumentation
 */

// 🎯 Core implementation
export { ContextualEventService, SilentContextualEventService } from './contextual-event-service.js';

// 🔧 Enhanced interfaces (MIGRATION ONLY - DELETE AFTER MIGRATION)
export { 
    EnhancedEventService,
    supportsCreateChild,
    supportsContextTracking,
    safeCreateChild,
    upgradeEventService
} from './enhanced-event-service.js';

// 📋 Types and interfaces
export type {
    EventServiceCreationContext,
    InternalExecutionContext,
    ContextualEventServiceInterface,
    ContextualEventData,
    ContextualEventServiceConfig
} from './types.js';

// 🏭 Factory utilities
export { ContextualEventServiceFactory, ContextualEventServiceHelpers } from './factory.js';

// 🧪 Testing utilities (only exported for test files)
export { MockContextualEventService } from './testing.js';

// 🎯 Re-export compatibility types from main event-service
export type { ServiceEventType, ServiceEventData } from '../event-service.js';
