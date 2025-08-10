/**
 * ContextualEventService Tests
 * 
 * Comprehensive tests for the new ContextualEventService implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextualEventService, SilentContextualEventService } from './contextual-event-service.js';
import { ContextualEventServiceFactory, ContextualEventServiceHelpers } from './factory.js';
import { MockContextualEventService, ContextualEventServiceTestHelpers } from './testing.js';
import type { EventServiceCreationContext } from './types.js';

describe('ContextualEventService', () => {
    let eventService: ContextualEventService;
    let mockEventService: MockContextualEventService;

    beforeEach(() => {
        mockEventService = new MockContextualEventService();
        eventService = new ContextualEventService(
            mockEventService,
            undefined,
            {
                executionId: 'test-execution',
                sourceType: 'test',
                sourceId: 'test-service'
            }
        );
    });

    describe('Core EventService methods', () => {
        it('should emit events with context injection', () => {
            const eventData = { message: 'test event' };

            eventService.emit('test.event', eventData);

            expect(mockEventService.getEventCount()).toBe(1);
            expect(mockEventService.wasEventEmitted('test.event')).toBe(true);

            const emittedEvents = mockEventService.getEventsOfType('test.event');
            expect(emittedEvents[0].data).toMatchObject({
                message: 'test event',
                executionId: 'test-execution',
                sourceType: 'test',
                sourceId: 'test-service'
            });
        });

        it('should track execution', () => {
            eventService.trackExecution('child-execution', 'test-execution', 2);

            expect(mockEventService.wasExecutionTracked('child-execution')).toBe(true);
            expect(mockEventService.trackedExecutions[0]).toMatchObject({
                executionId: 'child-execution',
                parentExecutionId: 'test-execution',
                level: 2
            });
        });

        it('should create bound emit functions', () => {
            const boundEmit = eventService.createBoundEmit('bound-execution');

            boundEmit('test.bound', { data: 'bound test' });

            expect(mockEventService.getEventCount()).toBe(1);
            const emittedEvents = mockEventService.getEventsOfType('test.bound');
            expect(emittedEvents[0].data).toMatchObject({
                data: 'bound test',
                executionId: 'bound-execution',
                parentExecutionId: 'test-execution'
            });
        });
    });

    describe('Child creation', () => {
        it('should create child EventService with inherited context', () => {
            const childContext: EventServiceCreationContext = {
                sourceType: 'agent',
                sourceId: 'child-agent',
                toolName: 'testTool'
            };

            const childService = eventService.createChild(childContext);

            // ContextualEventService creates a new instance, doesn't call baseService.createChild
            // So we check the child service directly
            expect(childService).toBeInstanceOf(ContextualEventService);

            // Verify child can emit events
            childService.emit('agent.test', { message: 'child event' });

            // The child should emit to its base service (which would be the same mockEventService)
            expect(mockEventService.getEventCount()).toBe(1);
            expect(mockEventService.wasEventEmitted('agent.test')).toBe(true);

            // Verify context inheritance
            const childContext_actual = childService.getExecutionContext();
            expect(childContext_actual?.sourceType).toBe('agent');
            expect(childContext_actual?.sourceId).toBe('child-agent');
            expect(childContext_actual?.toolName).toBe('testTool');
            expect(childContext_actual?.parentExecutionId).toBe('test-execution');
        });

        it('should create child with proper hierarchy', () => {
            const child1 = eventService.createChild({
                sourceType: 'agent',
                sourceId: 'agent-1'
            });

            const child2 = child1.createChild({
                sourceType: 'tool',
                sourceId: 'tool-1',
                toolName: 'assignTask'
            });

            // Verify hierarchy structure
            expect(child1).toBeInstanceOf(ContextualEventService);
            expect(child2).toBeInstanceOf(ContextualEventService);

            // Check context inheritance
            const child1Context = child1.getExecutionContext();
            const child2Context = child2.getExecutionContext();

            expect(child1Context?.sourceType).toBe('agent');
            expect(child1Context?.sourceId).toBe('agent-1');
            expect(child1Context?.parentExecutionId).toBe('test-execution');

            expect(child2Context?.sourceType).toBe('tool');
            expect(child2Context?.sourceId).toBe('tool-1');
            expect(child2Context?.toolName).toBe('assignTask');
            expect(child2Context?.parentExecutionId).toBe(child1Context?.executionId);
        });
    });

    describe('Context management', () => {
        it('should preserve execution context', () => {
            const context = eventService.getExecutionContext();

            expect(context).toBeDefined();
            expect(context?.executionId).toBe('test-execution');
            expect(context?.sourceType).toBe('test');
            expect(context?.sourceId).toBe('test-service');
        });

        it('should build context hierarchy', () => {
            const hierarchy = eventService.getContextHierarchy();

            expect(hierarchy).toHaveLength(1);
            expect(hierarchy[0]).toMatchObject({
                executionId: 'test-execution',
                sourceType: 'test',
                sourceId: 'test-service'
            });
        });
    });
});

describe('SilentContextualEventService', () => {
    let silentService: SilentContextualEventService;

    beforeEach(() => {
        silentService = new SilentContextualEventService();
    });

    it('should do nothing on emit', () => {
        expect(() => {
            silentService.emit('test.event', { data: 'test' });
        }).not.toThrow();
    });

    it('should create silent children', () => {
        const child = silentService.createChild({
            sourceType: 'test',
            sourceId: 'child'
        });

        expect(child).toBeInstanceOf(SilentContextualEventService);
        expect(child.getExecutionContext()).toBeUndefined();
    });
});

describe('ContextualEventServiceFactory', () => {
    it('should create EventService with context', () => {
        const eventService = ContextualEventServiceFactory.create({
            executionId: 'factory-test',
            sourceType: 'execution',
            sourceId: 'test-execution'
        });

        expect(eventService).toBeInstanceOf(ContextualEventService);
        expect(eventService.getExecutionContext()?.executionId).toBe('factory-test');
        expect(eventService.getExecutionContext()?.sourceType).toBe('execution');
    });

    it('should create root EventService', () => {
        const rootService = ContextualEventServiceHelpers.createRoot('root-123', 'execution');

        expect(rootService).toBeInstanceOf(ContextualEventService);
        const context = rootService.getExecutionContext();
        expect(context?.sourceType).toBe('execution');
        expect(context?.sourceId).toBe('root-123');
        expect(context?.executionLevel).toBe(0);
    });

    it('should create execution-scoped EventService', () => {
        const parentService = ContextualEventServiceFactory.create({
            executionId: 'parent-execution',
            sourceType: 'execution',
            sourceId: 'parent'
        });

        const scopedService = ContextualEventServiceHelpers.createExecutionScoped(
            parentService,
            'tool_execution',
            { toolType: 'generic' }
        );

        expect(scopedService).toBeInstanceOf(ContextualEventService);
        const context = scopedService.getExecutionContext();
        expect(context?.sourceType).toBe('execution');
        expect(context?.executionLevel).toBe(2);
        expect(context?.metadata?.phase).toBe('tool_execution');
        expect(context?.metadata?.toolType).toBe('generic');
        expect(context?.parentExecutionId).toBe('parent-execution');
    });

    it('should wrap existing EventService', () => {
        const existingService = new MockContextualEventService();
        const wrappedService = ContextualEventServiceFactory.wrap(existingService, {
            executionId: 'wrapped-test',
            sourceType: 'wrapped'
        });

        expect(wrappedService).toBeInstanceOf(ContextualEventService);
    });
});

describe('Testing utilities', () => {
    it('should create mock with predefined events', () => {
        const mock = ContextualEventServiceTestHelpers.createMockWithEvents([
            { eventType: 'test.event1', data: { msg: 'event1' } },
            { eventType: 'test.event2', data: { msg: 'event2' } }
        ]);

        expect(mock.getEventCount()).toBe(2);
        expect(mock.wasEventEmitted('test.event1')).toBe(true);
        expect(mock.wasEventEmitted('test.event2')).toBe(true);
    });

    it('should create mock tree structure', () => {
        const { parent, children } = ContextualEventServiceTestHelpers.createMockTree(
            { executionId: 'parent', sourceType: 'parent' },
            [
                { executionId: 'child1', sourceType: 'child' },
                { executionId: 'child2', sourceType: 'child' }
            ]
        );

        expect(parent.getChildCount()).toBe(2);
        expect(children).toHaveLength(2);
        expect(children[0]).toBeInstanceOf(MockContextualEventService);
        expect(children[1]).toBeInstanceOf(MockContextualEventService);
    });

    it('should verify event order', () => {
        const mock = new MockContextualEventService();

        mock.emit('event.first', {});
        mock.emit('event.second', {});
        mock.emit('event.third', {});

        const orderCorrect = ContextualEventServiceTestHelpers.verifyEventOrder(
            mock,
            ['event.first', 'event.second', 'event.third']
        );

        expect(orderCorrect).toBe(true);

        const orderIncorrect = ContextualEventServiceTestHelpers.verifyEventOrder(
            mock,
            ['event.second', 'event.first', 'event.third']
        );

        expect(orderIncorrect).toBe(false);
    });
});
