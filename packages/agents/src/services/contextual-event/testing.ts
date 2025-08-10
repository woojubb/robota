/**
 * Testing Utilities for ContextualEventService
 * 
 * Provides mock implementations and testing helpers for ContextualEventService
 */

import type { SimpleLogger } from '../../utils/simple-logger.js';
import type { ServiceEventType, ServiceEventData } from '../event-service.js';
import type {
    EventServiceCreationContext,
    ContextualEventServiceInterface,
    InternalExecutionContext
} from './types.js';

/**
 * Mock implementation of ContextualEventService for testing
 * Records all events and method calls for verification
 */
export class MockContextualEventService implements ContextualEventServiceInterface {
    // 📊 Recording arrays for test verification
    public readonly emittedEvents: Array<{ eventType: string; data: ServiceEventData; timestamp: Date }> = [];
    public readonly trackedExecutions: Array<{ executionId: string; parentExecutionId?: string; level?: number }> = [];
    public readonly createdChildren: Array<{ context: EventServiceCreationContext; timestamp: Date }> = [];
    public readonly boundEmitCalls: Array<{ executionId: string; timestamp: Date }> = [];

    private readonly mockExecutionContext?: InternalExecutionContext;
    private readonly mockLogger?: SimpleLogger;

    constructor(
        executionContext?: EventServiceCreationContext,
        logger?: SimpleLogger
    ) {
        this.mockLogger = logger;

        if (executionContext) {
            this.mockExecutionContext = {
                executionId: executionContext.executionId || 'mock-execution',
                parentExecutionId: executionContext.parentExecutionId,
                rootExecutionId: executionContext.rootExecutionId,
                executionLevel: executionContext.executionLevel || 1,
                executionPath: executionContext.executionPath || [],
                sourceType: executionContext.sourceType || 'mock',
                sourceId: executionContext.sourceId || 'mock-service',
                toolName: executionContext.toolName,
                parameters: executionContext.parameters,
                metadata: executionContext.metadata,
                createdAt: new Date()
            };
        }
    }

    /**
     * 🎯 Mock emit - records events instead of actually emitting
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        this.emittedEvents.push({
            eventType,
            data: { ...data },
            timestamp: new Date()
        });

        if (this.mockLogger) {
            this.mockLogger.debug(`[MockContextualEventService] Recorded event: ${eventType}`, data);
        }
    }

    /**
     * 📊 Mock trackExecution - records tracking calls
     */
    trackExecution(executionId: string, parentExecutionId?: string, level?: number): void {
        this.trackedExecutions.push({
            executionId,
            parentExecutionId,
            level
        });

        if (this.mockLogger) {
            this.mockLogger.debug(`[MockContextualEventService] Recorded execution tracking: ${executionId}`);
        }
    }

    /**
     * 🔗 Mock createBoundEmit - records bound emit creation
     */
    createBoundEmit(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void {
        this.boundEmitCalls.push({
            executionId,
            timestamp: new Date()
        });

        // Return a bound function that calls emit with injected context
        return (eventType: ServiceEventType, data: ServiceEventData) => {
            this.emit(eventType, {
                ...data,
                executionId: executionId,
                parentExecutionId: this.mockExecutionContext?.executionId
            });
        };
    }

    /**
     * 🏭 Mock createChild - creates new mock instance and records the call
     */
    createChild(childContext: EventServiceCreationContext): ContextualEventServiceInterface {
        this.createdChildren.push({
            context: { ...childContext },
            timestamp: new Date()
        });

        if (this.mockLogger) {
            this.mockLogger.debug(`[MockContextualEventService] Created child with context:`, childContext);
        }

        // Create a new mock instance with the child context
        return new MockContextualEventService(childContext, this.mockLogger);
    }

    /**
     * 📊 Mock getExecutionContext
     */
    getExecutionContext(): InternalExecutionContext | undefined {
        return this.mockExecutionContext;
    }

    /**
     * 🌳 Mock getContextHierarchy
     */
    getContextHierarchy(): InternalExecutionContext[] {
        return this.mockExecutionContext ? [this.mockExecutionContext] : [];
    }

    // 🧪 Testing utility methods

    /**
     * Check if a specific event was emitted
     */
    wasEventEmitted(eventType: string): boolean {
        return this.emittedEvents.some(event => event.eventType === eventType);
    }

    /**
     * Get all events of a specific type
     */
    getEventsOfType(eventType: string): Array<{ eventType: string; data: ServiceEventData; timestamp: Date }> {
        return this.emittedEvents.filter(event => event.eventType === eventType);
    }

    /**
     * Get the count of emitted events
     */
    getEventCount(): number {
        return this.emittedEvents.length;
    }

    /**
     * Get the count of created children
     */
    getChildCount(): number {
        return this.createdChildren.length;
    }

    /**
     * Check if execution was tracked
     */
    wasExecutionTracked(executionId: string): boolean {
        return this.trackedExecutions.some(track => track.executionId === executionId);
    }

    /**
     * Clear all recorded data (useful for test cleanup)
     */
    clear(): void {
        this.emittedEvents.length = 0;
        this.trackedExecutions.length = 0;
        this.createdChildren.length = 0;
        this.boundEmitCalls.length = 0;
    }

    /**
     * Get a summary of all recorded activity
     */
    getActivitySummary(): {
        totalEvents: number;
        uniqueEventTypes: string[];
        totalChildren: number;
        totalExecutionTracks: number;
        totalBoundEmits: number;
    } {
        const uniqueEventTypes = [...new Set(this.emittedEvents.map(e => e.eventType))];

        return {
            totalEvents: this.emittedEvents.length,
            uniqueEventTypes,
            totalChildren: this.createdChildren.length,
            totalExecutionTracks: this.trackedExecutions.length,
            totalBoundEmits: this.boundEmitCalls.length
        };
    }
}

/**
 * Testing helper functions
 */
export class ContextualEventServiceTestHelpers {
    /**
     * Create a mock EventService with predefined events
     */
    static createMockWithEvents(
        events: Array<{ eventType: string; data: ServiceEventData }>
    ): MockContextualEventService {
        const mock = new MockContextualEventService();

        events.forEach(({ eventType, data }) => {
            mock.emit(eventType, data);
        });

        return mock;
    }

    /**
     * Create a mock EventService tree (parent with children)
     */
    static createMockTree(
        parentContext: EventServiceCreationContext,
        childContexts: EventServiceCreationContext[]
    ): {
        parent: MockContextualEventService;
        children: MockContextualEventService[];
    } {
        const parent = new MockContextualEventService(parentContext);
        const children = childContexts.map(context =>
            parent.createChild(context) as MockContextualEventService
        );

        return { parent, children };
    }

    /**
     * Verify event emission order
     */
    static verifyEventOrder(
        mock: MockContextualEventService,
        expectedOrder: string[]
    ): boolean {
        if (mock.emittedEvents.length !== expectedOrder.length) {
            return false;
        }

        return mock.emittedEvents.every((event, index) =>
            event.eventType === expectedOrder[index]
        );
    }

    /**
     * Verify context hierarchy structure
     */
    static verifyContextHierarchy(
        mock: MockContextualEventService,
        expectedLevels: number[]
    ): boolean {
        const hierarchy = mock.getContextHierarchy();

        if (hierarchy.length !== expectedLevels.length) {
            return false;
        }

        return hierarchy.every((context, index) =>
            context.executionLevel === expectedLevels[index]
        );
    }
}
