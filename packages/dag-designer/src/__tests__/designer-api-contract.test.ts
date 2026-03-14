import { describe, it, expect } from 'vitest';
import { hasValidRunResult } from '../client/designer-api-client.js';
import type { IRunResult } from '@robota-sdk/dag-core';

describe('hasValidRunResult contract validation', () => {
    const validTrace = {
        nodeId: 'node-1',
        nodeType: 'text-output',
        input: { text: 'hello' },
        output: { result: 'ok' },
        estimatedCredits: 0.001,
        totalCredits: 0.001
    };

    const validNodeError = {
        nodeId: 'node-2',
        nodeType: 'llm-text',
        error: {
            code: 'NODE_EXECUTION_FAILED',
            category: 'task_execution' as const,
            message: 'Provider returned 500.',
            retryable: true
        },
        occurredAt: '2026-03-14T00:00:00.000Z'
    };

    it('accepts a valid success result', () => {
        const result: IRunResult = {
            dagRunId: 'run-abc-123',
            status: 'success',
            traces: [validTrace],
            nodeErrors: [],
            totalCredits: 0.001
        };
        expect(hasValidRunResult(result)).toBe(true);
    });

    it('accepts a valid failed result', () => {
        const result: IRunResult = {
            dagRunId: 'run-def-456',
            status: 'failed',
            traces: [],
            nodeErrors: [validNodeError],
            totalCredits: 0
        };
        expect(hasValidRunResult(result)).toBe(true);
    });

    it('rejects when status field is missing', () => {
        const result = {
            dagRunId: 'run-1',
            traces: [],
            nodeErrors: [],
            totalCredits: 0
        } as unknown as IRunResult;
        expect(hasValidRunResult(result)).toBe(false);
    });

    it('rejects when nodeErrors field is missing', () => {
        const result = {
            dagRunId: 'run-1',
            status: 'success',
            traces: [],
            totalCredits: 0
        } as unknown as IRunResult;
        expect(hasValidRunResult(result)).toBe(false);
    });

    it('rejects when dagRunId field is missing', () => {
        const result = {
            status: 'success',
            traces: [],
            nodeErrors: [],
            totalCredits: 0
        } as unknown as IRunResult;
        expect(hasValidRunResult(result)).toBe(false);
    });

    it('rejects when traces field is missing', () => {
        const result = {
            dagRunId: 'run-1',
            status: 'success',
            nodeErrors: [],
            totalCredits: 0
        } as unknown as IRunResult;
        expect(hasValidRunResult(result)).toBe(false);
    });

    it('rejects when totalCredits field is missing', () => {
        const result = {
            dagRunId: 'run-1',
            status: 'success',
            traces: [],
            nodeErrors: []
        } as unknown as IRunResult;
        expect(hasValidRunResult(result)).toBe(false);
    });

    it('rejects when a trace has invalid shape', () => {
        const result: IRunResult = {
            dagRunId: 'run-1',
            status: 'success',
            traces: [{ nodeId: 'n1' } as unknown as IRunResult['traces'][number]],
            nodeErrors: [],
            totalCredits: 0
        };
        expect(hasValidRunResult(result)).toBe(false);
    });

    it('accepts a result with empty traces and empty nodeErrors', () => {
        const result: IRunResult = {
            dagRunId: 'run-1',
            status: 'success',
            traces: [],
            nodeErrors: [],
            totalCredits: 0
        };
        expect(hasValidRunResult(result)).toBe(true);
    });
});
