import { describe, expect, it, vi } from 'vitest';
import {
    StaticNodeLifecycleFactory,
    createStaticNodeLifecycleFactory
} from '../lifecycle/static-node-lifecycle-factory.js';
import { StaticNodeTaskHandlerRegistry } from '../lifecycle/default-node-task-handlers.js';
import type { INodeTaskHandler } from '@robota-sdk/dag-core';

describe('StaticNodeLifecycleFactory', () => {
    const handler: INodeTaskHandler = {
        execute: vi.fn().mockResolvedValue({ ok: true, value: {} })
    };

    it('creates lifecycle for registered node type', () => {
        const registry = new StaticNodeTaskHandlerRegistry({ 'test-node': handler });
        const factory = new StaticNodeLifecycleFactory(registry);
        const result = factory.create('test-node');
        expect(result.ok).toBe(true);
    });

    it('returns error for unregistered node type', () => {
        const registry = new StaticNodeTaskHandlerRegistry({});
        const factory = new StaticNodeLifecycleFactory(registry);
        const result = factory.create('unknown-type');
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED');
    });
});

describe('createStaticNodeLifecycleFactory', () => {
    it('creates factory from handler map', () => {
        const handler: INodeTaskHandler = {
            execute: vi.fn().mockResolvedValue({ ok: true, value: {} })
        };
        const factory = createStaticNodeLifecycleFactory({ 'test-node': handler });
        const result = factory.create('test-node');
        expect(result.ok).toBe(true);
    });
});

describe('StaticNodeTaskHandlerRegistry', () => {
    it('returns handler for registered type', () => {
        const handler: INodeTaskHandler = {
            execute: vi.fn()
        };
        const registry = new StaticNodeTaskHandlerRegistry({ 'test-node': handler });
        expect(registry.getHandler('test-node')).toBe(handler);
    });

    it('returns undefined for unregistered type', () => {
        const registry = new StaticNodeTaskHandlerRegistry({});
        expect(registry.getHandler('unknown')).toBeUndefined();
    });

    it('lists registered node types', () => {
        const registry = new StaticNodeTaskHandlerRegistry({
            'type-a': { execute: vi.fn() },
            'type-b': { execute: vi.fn() }
        });
        expect(registry.listNodeTypes()).toEqual(['type-a', 'type-b']);
    });
});
