import { describe, expect, it } from 'vitest';
import type { IDagRun } from '@robota-sdk/dag-core';
import { parseDefinitionSnapshot } from '../services/definition-snapshot-parser.js';

function createDagRun(snapshot?: string): IDagRun {
    return {
        dagRunId: 'dag-run-1',
        dagId: 'dag-1',
        version: 1,
        status: 'running',
        runKey: 'dag-1:run-1',
        logicalDate: '2026-02-14T03:00:00.000Z',
        trigger: 'manual',
        startedAt: '2026-02-14T03:00:00.000Z',
        definitionSnapshot: snapshot
    };
}

const VALID_SNAPSHOT = JSON.stringify({
    dagId: 'dag-1',
    version: 1,
    status: 'published',
    nodes: [{ nodeId: 'entry', nodeType: 'input', dependsOn: [], inputs: [], outputs: [], config: {} }],
    edges: []
});

describe('parseDefinitionSnapshot', () => {
    it('parses valid snapshot successfully', () => {
        const dagRun = createDagRun(VALID_SNAPSHOT);
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.dagId).toBe('dag-1');
            expect(result.value.version).toBe(1);
            expect(result.value.nodes).toHaveLength(1);
        }
    });

    it('returns error when snapshot is missing (undefined)', () => {
        const dagRun = createDagRun(undefined);
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING');
        }
    });

    it('returns error when snapshot is empty string', () => {
        const dagRun = createDagRun('');
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING');
        }
    });

    it('returns error when snapshot is whitespace-only', () => {
        const dagRun = createDagRun('   ');
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING');
        }
    });

    it('returns error for invalid JSON', () => {
        const dagRun = createDagRun('not-json{');
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_PARSE_FAILED');
        }
    });

    it('returns error when parsed value is an array', () => {
        const dagRun = createDagRun('[1, 2, 3]');
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
        }
    });

    it('returns error when required fields are missing', () => {
        const dagRun = createDagRun(JSON.stringify({ dagId: 'dag-1' }));
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
        }
    });

    it('returns error when dagId is not string', () => {
        const dagRun = createDagRun(JSON.stringify({
            dagId: 123,
            version: 1,
            status: 'published',
            nodes: [],
            edges: []
        }));
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
        }
    });

    it('returns error when nodes is not array', () => {
        const dagRun = createDagRun(JSON.stringify({
            dagId: 'dag-1',
            version: 1,
            status: 'published',
            nodes: 'not-array',
            edges: []
        }));
        const result = parseDefinitionSnapshot(dagRun, 'dag-run-1');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID');
        }
    });
});
