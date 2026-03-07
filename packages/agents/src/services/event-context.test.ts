import { describe, it, expect } from 'vitest';
import {
    StructuredEventService,
    ObservableEventService,
    bindWithOwnerPath
} from './event-service';
import type { IEventContext, IBaseEventData } from '../interfaces/event-service';

describe('Event context depth and spanId', () => {
    it('emits events with depth derived from ownerPath length', () => {
        const emitted: { context?: IEventContext }[] = [];
        const base = new ObservableEventService();
        base.subscribe((_type, _data, context) => {
            emitted.push({ context });
        });

        const scoped = bindWithOwnerPath(base, {
            ownerType: 'execution',
            ownerId: 'exec-1',
            ownerPath: [
                { type: 'agent', id: 'agent-0' },
                { type: 'execution', id: 'exec-1' }
            ]
        });

        scoped.emit('START', { timestamp: new Date() });

        expect(emitted).toHaveLength(1);
        expect(emitted[0].context?.depth).toBe(2);
    });

    it('emits depth 0 for empty ownerPath', () => {
        const emitted: { context?: IEventContext }[] = [];
        const base = new ObservableEventService();
        base.subscribe((_type, _data, context) => {
            emitted.push({ context });
        });

        const scoped = bindWithOwnerPath(base, {
            ownerType: 'root',
            ownerId: 'root-0',
            ownerPath: []
        });

        scoped.emit('START', { timestamp: new Date() });

        expect(emitted[0].context?.depth).toBe(0);
    });

    it('generates a spanId when not provided in context', () => {
        const emitted: { context?: IEventContext }[] = [];
        const base = new ObservableEventService();
        base.subscribe((_type, _data, context) => {
            emitted.push({ context });
        });

        const scoped = bindWithOwnerPath(base, {
            ownerType: 'execution',
            ownerId: 'exec-1',
            ownerPath: [{ type: 'execution', id: 'exec-1' }]
        });

        scoped.emit('START', { timestamp: new Date() });

        expect(emitted[0].context?.spanId).toBeDefined();
        expect(emitted[0].context?.spanId).toMatch(/^span_/);
    });

    it('preserves caller-provided spanId', () => {
        const emitted: { context?: IEventContext }[] = [];
        const base = new ObservableEventService();
        base.subscribe((_type, _data, context) => {
            emitted.push({ context });
        });

        const scoped = bindWithOwnerPath(base, {
            ownerType: 'execution',
            ownerId: 'exec-1',
            ownerPath: [{ type: 'execution', id: 'exec-1' }]
        });

        scoped.emit('START', { timestamp: new Date() }, {
            ownerType: 'execution',
            ownerId: 'exec-1',
            ownerPath: [],
            spanId: 'custom-span-123'
        });

        expect(emitted[0].context?.spanId).toBe('custom-span-123');
    });

    it('generates unique spanIds for different events', () => {
        const emitted: { context?: IEventContext }[] = [];
        const base = new ObservableEventService();
        base.subscribe((_type, _data, context) => {
            emitted.push({ context });
        });

        const scoped = bindWithOwnerPath(base, {
            ownerType: 'execution',
            ownerId: 'exec-1',
            ownerPath: [{ type: 'execution', id: 'exec-1' }]
        });

        scoped.emit('START', { timestamp: new Date() });
        scoped.emit('COMPLETE', { timestamp: new Date() });

        expect(emitted[0].context?.spanId).not.toBe(emitted[1].context?.spanId);
    });

    it('depth reflects nested ownerPath hierarchy', () => {
        const emitted: { context?: IEventContext }[] = [];
        const base = new ObservableEventService();
        base.subscribe((_type, _data, context) => {
            emitted.push({ context });
        });

        // Level 1: agent
        const agentScoped = bindWithOwnerPath(base, {
            ownerType: 'agent',
            ownerId: 'agent-0',
            ownerPath: [{ type: 'agent', id: 'agent-0' }]
        });

        // Level 2: execution under agent
        const execScoped = bindWithOwnerPath(base, {
            ownerType: 'execution',
            ownerId: 'exec-1',
            ownerPath: [
                { type: 'agent', id: 'agent-0' },
                { type: 'execution', id: 'exec-1' }
            ]
        });

        // Level 3: tool under execution
        const toolScoped = bindWithOwnerPath(base, {
            ownerType: 'tool',
            ownerId: 'tool-1',
            ownerPath: [
                { type: 'agent', id: 'agent-0' },
                { type: 'execution', id: 'exec-1' },
                { type: 'tool', id: 'tool-1' }
            ]
        });

        agentScoped.emit('START', { timestamp: new Date() });
        execScoped.emit('START', { timestamp: new Date() });
        toolScoped.emit('START', { timestamp: new Date() });

        expect(emitted[0].context?.depth).toBe(1);
        expect(emitted[1].context?.depth).toBe(2);
        expect(emitted[2].context?.depth).toBe(3);
    });
});
