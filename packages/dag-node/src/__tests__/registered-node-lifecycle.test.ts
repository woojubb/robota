import { describe, expect, it, vi } from 'vitest';
import { RegisteredNodeLifecycle } from '../lifecycle/registered-node-lifecycle.js';
import type { INodeTaskHandler, INodeExecutionContext, TPortPayload, IPortDefinition } from '@robota-sdk/dag-core';

function makeContext(
    inputs: IPortDefinition[] = [],
    outputs: IPortDefinition[] = []
): INodeExecutionContext {
    return {
        dagId: 'dag-1',
        dagRunId: 'run-1',
        taskRunId: 'task-1',
        nodeDefinition: {
            nodeId: 'node-1',
            nodeType: 'test',
            dependsOn: [],
            config: {},
            inputs,
            outputs
        },
        nodeManifest: {
            nodeType: 'test',
            displayName: 'Test',
            category: 'test',
            inputs,
            outputs
        },
        attempt: 1,
        executionPath: [],
        currentTotalCredits: 0
    };
}

describe('RegisteredNodeLifecycle', () => {
    describe('initialize', () => {
        it('returns ok when handler has no initialize', async () => {
            const handler: INodeTaskHandler = {
                execute: vi.fn().mockResolvedValue({ ok: true, value: {} })
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.initialize(makeContext());
            expect(result.ok).toBe(true);
        });

        it('delegates to handler.initialize when present', async () => {
            const handler: INodeTaskHandler = {
                initialize: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
                execute: vi.fn()
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const ctx = makeContext();
            await lifecycle.initialize(ctx);
            expect(handler.initialize).toHaveBeenCalledWith(ctx);
        });
    });

    describe('validateInput', () => {
        it('validates required input ports', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'text', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = {
                execute: vi.fn()
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput({}, makeContext(inputs));
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_REQUIRED_INPUT_MISSING');
        });

        it('validates input port type', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'text', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput({ text: 42 }, makeContext(inputs));
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
        });

        it('passes valid input', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'text', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput({ text: 'hello' }, makeContext(inputs));
            expect(result.ok).toBe(true);
        });

        it('allows optional missing ports', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'text', type: 'string', required: false }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput({}, makeContext(inputs));
            expect(result.ok).toBe(true);
        });

        it('validates list port type mismatch', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'items', type: 'string', required: true, isList: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput(
                { items: 'not-array' },
                makeContext(inputs)
            );
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
        });

        it('validates list minItems', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'items', type: 'string', required: true, isList: true, minItems: 2 }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput(
                { items: ['a'] },
                makeContext(inputs)
            );
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MIN_ITEMS_NOT_SATISFIED');
        });

        it('validates list maxItems', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'items', type: 'string', required: true, isList: true, maxItems: 1 }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput(
                { items: ['a', 'b'] },
                makeContext(inputs)
            );
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MAX_ITEMS_EXCEEDED');
        });

        it('delegates to handler.validateInput after base validation passes', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'text', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = {
                validateInput: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
                execute: vi.fn()
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const payload: TPortPayload = { text: 'hello' };
            await lifecycle.validateInput(payload, makeContext(inputs));
            expect(handler.validateInput).toHaveBeenCalled();
        });
    });

    describe('estimateCost', () => {
        it('returns zero cost when handler has no estimateCost', async () => {
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.estimateCost({}, makeContext());
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.estimatedCredits).toBe(0);
        });

        it('delegates to handler.estimateCost when present', async () => {
            const handler: INodeTaskHandler = {
                estimateCost: vi.fn().mockResolvedValue({ ok: true, value: { estimatedCredits: 0.5 } }),
                execute: vi.fn()
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.estimateCost({}, makeContext());
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.estimatedCredits).toBe(0.5);
        });
    });

    describe('execute', () => {
        it('delegates to handler.execute', async () => {
            const handler: INodeTaskHandler = {
                execute: vi.fn().mockResolvedValue({ ok: true, value: { out: 'done' } })
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.execute({ text: 'in' }, makeContext());
            expect(result.ok).toBe(true);
            expect(handler.execute).toHaveBeenCalled();
        });
    });

    describe('validateOutput', () => {
        it('validates required output ports', async () => {
            const outputs: IPortDefinition[] = [
                { key: 'result', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateOutput({}, makeContext([], outputs));
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_REQUIRED_OUTPUT_MISSING');
        });

        it('validates output port type', async () => {
            const outputs: IPortDefinition[] = [
                { key: 'result', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateOutput({ result: 42 }, makeContext([], outputs));
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_OUTPUT_TYPE_MISMATCH');
        });

        it('passes valid output', async () => {
            const outputs: IPortDefinition[] = [
                { key: 'result', type: 'string', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateOutput(
                { result: 'done' },
                makeContext([], outputs)
            );
            expect(result.ok).toBe(true);
        });

        it('validates output list minItems', async () => {
            const outputs: IPortDefinition[] = [
                { key: 'items', type: 'string', required: true, isList: true, minItems: 2 }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateOutput(
                { items: ['a'] },
                makeContext([], outputs)
            );
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_OUTPUT_MIN_ITEMS_NOT_SATISFIED');
        });

        it('validates output list maxItems', async () => {
            const outputs: IPortDefinition[] = [
                { key: 'items', type: 'string', required: true, isList: true, maxItems: 1 }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateOutput(
                { items: ['a', 'b'] },
                makeContext([], outputs)
            );
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_OUTPUT_MAX_ITEMS_EXCEEDED');
        });
    });

    describe('dispose', () => {
        it('returns ok when handler has no dispose', async () => {
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.dispose(makeContext());
            expect(result.ok).toBe(true);
        });

        it('delegates to handler.dispose when present', async () => {
            const handler: INodeTaskHandler = {
                dispose: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
                execute: vi.fn()
            };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            await lifecycle.dispose(makeContext());
            expect(handler.dispose).toHaveBeenCalled();
        });
    });

    describe('binary port validation', () => {
        it('validates binary input port type', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'image', type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);

            // Valid binary value
            const validResult = await lifecycle.validateInput(
                { image: { kind: 'image', mimeType: 'image/png', uri: 'https://example.com/img.png' } },
                makeContext(inputs)
            );
            expect(validResult.ok).toBe(true);

            // Invalid: wrong kind
            const wrongKindResult = await lifecycle.validateInput(
                { image: { kind: 'video', mimeType: 'image/png', uri: 'https://example.com/img.png' } },
                makeContext(inputs)
            );
            expect(wrongKindResult.ok).toBe(false);
        });

        it('validates binary port with mimeType restriction', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'image', type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);

            const result = await lifecycle.validateInput(
                { image: { kind: 'image', mimeType: 'image/jpeg', uri: 'https://example.com/img.jpg' } },
                makeContext(inputs)
            );
            expect(result.ok).toBe(false);
        });

        it('validates number port type', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'count', type: 'number', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput({ count: 42 }, makeContext(inputs));
            expect(result.ok).toBe(true);
        });

        it('validates boolean port type', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'flag', type: 'boolean', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput({ flag: true }, makeContext(inputs));
            expect(result.ok).toBe(true);
        });

        it('validates object port type', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'data', type: 'object', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput(
                { data: { key: 'value' } },
                makeContext(inputs)
            );
            expect(result.ok).toBe(true);
        });

        it('validates array port type', async () => {
            const inputs: IPortDefinition[] = [
                { key: 'items', type: 'array', required: true }
            ];
            const handler: INodeTaskHandler = { execute: vi.fn() };
            const lifecycle = new RegisteredNodeLifecycle(handler);
            const result = await lifecycle.validateInput(
                { items: ['a', 'b'] },
                makeContext(inputs)
            );
            expect(result.ok).toBe(true);
        });
    });
});
