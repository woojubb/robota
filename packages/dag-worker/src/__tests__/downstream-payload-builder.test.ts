import { describe, expect, it } from 'vitest';
import type { IDagDefinition, ITaskRun } from '@robota-sdk/dag-core';
import { buildDownstreamPayload } from '../services/downstream-payload-builder.js';

function createDefinition(overrides?: Partial<IDagDefinition>): IDagDefinition {
    return {
        dagId: 'dag-1',
        version: 1,
        status: 'published',
        nodes: [
            {
                nodeId: 'a',
                nodeType: 'input',
                dependsOn: [],
                inputs: [],
                outputs: [{ key: 'text', type: 'string', required: false }],
                config: {}
            },
            {
                nodeId: 'b',
                nodeType: 'processor',
                dependsOn: ['a'],
                inputs: [{ key: 'text', type: 'string', required: false }],
                outputs: [],
                config: {}
            }
        ],
        edges: [
            { from: 'a', to: 'b', bindings: [{ outputKey: 'text', inputKey: 'text' }] }
        ],
        ...overrides
    };
}

function createSuccessTaskRun(nodeId: string, output: Record<string, unknown>): ITaskRun {
    return {
        taskRunId: `${nodeId}-run`,
        dagRunId: 'dag-run-1',
        nodeId,
        status: 'success',
        attempt: 1,
        outputSnapshot: JSON.stringify(output)
    };
}

describe('buildDownstreamPayload', () => {
    it('resolves payload from upstream output through edge bindings', () => {
        const definition = createDefinition();
        const taskRuns = [createSuccessTaskRun('a', { text: 'hello' })];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({ text: 'hello' });
        }
    });

    it('returns empty payload when no incoming edges', () => {
        const definition = createDefinition();
        const taskRuns: ITaskRun[] = [];

        const result = buildDownstreamPayload(definition, taskRuns, 'a');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({});
        }
    });

    it('returns error when downstream node not found', () => {
        const definition = createDefinition();
        const taskRuns: ITaskRun[] = [];

        const result = buildDownstreamPayload(definition, taskRuns, 'nonexistent');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DOWNSTREAM_NODE_NOT_FOUND');
        }
    });

    it('returns error when edge has no bindings', () => {
        const definition = createDefinition({
            edges: [{ from: 'a', to: 'b', bindings: [] }]
        });
        const taskRuns = [createSuccessTaskRun('a', { text: 'hello' })];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_BINDING_REQUIRED');
        }
    });

    it('returns error when upstream output snapshot is missing', () => {
        const definition = createDefinition();
        const taskRuns: ITaskRun[] = [{
            taskRunId: 'a-run',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'success',
            attempt: 1
            // no outputSnapshot
        }];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_UPSTREAM_OUTPUT_MISSING');
        }
    });

    it('returns error when upstream output snapshot is invalid JSON', () => {
        const definition = createDefinition();
        const taskRuns: ITaskRun[] = [{
            taskRunId: 'a-run',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'success',
            attempt: 1,
            outputSnapshot: 'not-json{'
        }];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_UPSTREAM_OUTPUT_PARSE_FAILED');
        }
    });

    it('returns error when upstream output snapshot is an array', () => {
        const definition = createDefinition();
        const taskRuns: ITaskRun[] = [{
            taskRunId: 'a-run',
            dagRunId: 'dag-run-1',
            nodeId: 'a',
            status: 'success',
            attempt: 1,
            outputSnapshot: '[1, 2, 3]'
        }];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_UPSTREAM_OUTPUT_INVALID');
        }
    });

    it('returns error when binding outputKey is not in upstream output', () => {
        const definition = createDefinition();
        const taskRuns = [createSuccessTaskRun('a', { other: 'value' })];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_BINDING_OUTPUT_KEY_MISSING');
        }
    });

    it('returns error when multiple bindings target same non-list input key', () => {
        const definition: IDagDefinition = {
            dagId: 'dag-1',
            version: 1,
            status: 'published',
            nodes: [
                { nodeId: 'a1', nodeType: 'input', dependsOn: [], inputs: [], outputs: [{ key: 'x', type: 'string', required: false }], config: {} },
                { nodeId: 'a2', nodeType: 'input', dependsOn: [], inputs: [], outputs: [{ key: 'x', type: 'string', required: false }], config: {} },
                { nodeId: 'b', nodeType: 'processor', dependsOn: ['a1', 'a2'], inputs: [{ key: 'text', type: 'string', required: false }], outputs: [], config: {} }
            ],
            edges: [
                { from: 'a1', to: 'b', bindings: [{ outputKey: 'x', inputKey: 'text' }] },
                { from: 'a2', to: 'b', bindings: [{ outputKey: 'x', inputKey: 'text' }] }
            ]
        };
        const taskRuns = [
            createSuccessTaskRun('a1', { x: 'first' }),
            createSuccessTaskRun('a2', { x: 'second' })
        ];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_BINDING_INPUT_KEY_CONFLICT');
        }
    });

    it('collects values into list-type input port', () => {
        const definition: IDagDefinition = {
            dagId: 'dag-1',
            version: 1,
            status: 'published',
            nodes: [
                { nodeId: 'a1', nodeType: 'input', dependsOn: [], inputs: [], outputs: [{ key: 'x', type: 'string', required: false }], config: {} },
                { nodeId: 'a2', nodeType: 'input', dependsOn: [], inputs: [], outputs: [{ key: 'x', type: 'string', required: false }], config: {} },
                { nodeId: 'b', nodeType: 'processor', dependsOn: ['a1', 'a2'], inputs: [{ key: 'items', type: 'string', required: false, isList: true }], outputs: [], config: {} }
            ],
            edges: [
                { from: 'a1', to: 'b', bindings: [{ outputKey: 'x', inputKey: 'items' }] },
                { from: 'a2', to: 'b', bindings: [{ outputKey: 'x', inputKey: 'items' }] }
            ]
        };
        const taskRuns = [
            createSuccessTaskRun('a1', { x: 'first' }),
            createSuccessTaskRun('a2', { x: 'second' })
        ];

        const result = buildDownstreamPayload(definition, taskRuns, 'b');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.items).toEqual(['first', 'second']);
        }
    });
});
