import { describe, expect, it } from 'vitest';
import {
    buildDagError,
    buildValidationError,
    buildDispatchError,
    buildLeaseError,
    buildTaskExecutionError
} from '../utils/error-builders.js';

describe('buildDagError', () => {
    it('creates error with all required fields', () => {
        const error = buildDagError('validation', 'TEST_CODE', 'test message', false);
        expect(error).toEqual({
            code: 'TEST_CODE',
            category: 'validation',
            message: 'test message',
            retryable: false,
            context: undefined
        });
    });

    it('includes context when provided', () => {
        const error = buildDagError('dispatch', 'D_CODE', 'dispatch msg', true, { nodeId: 'n1' });
        expect(error.context).toEqual({ nodeId: 'n1' });
        expect(error.retryable).toBe(true);
    });
});

describe('buildValidationError', () => {
    it('creates non-retryable validation category error', () => {
        const error = buildValidationError('VAL_CODE', 'validation msg');
        expect(error.category).toBe('validation');
        expect(error.retryable).toBe(false);
        expect(error.code).toBe('VAL_CODE');
    });

    it('passes context through', () => {
        const error = buildValidationError('VAL_CODE', 'msg', { key: 'value' });
        expect(error.context).toEqual({ key: 'value' });
    });
});

describe('buildDispatchError', () => {
    it('creates retryable dispatch category error', () => {
        const error = buildDispatchError('DISP_CODE', 'dispatch msg');
        expect(error.category).toBe('dispatch');
        expect(error.retryable).toBe(true);
    });
});

describe('buildLeaseError', () => {
    it('creates non-retryable lease category error', () => {
        const error = buildLeaseError('LEASE_CODE', 'lease msg');
        expect(error.category).toBe('lease');
        expect(error.retryable).toBe(false);
    });
});

describe('buildTaskExecutionError', () => {
    it('creates task_execution category error with configurable retryability', () => {
        const retryable = buildTaskExecutionError('EXEC_CODE', 'exec msg', true);
        expect(retryable.category).toBe('task_execution');
        expect(retryable.retryable).toBe(true);

        const nonRetryable = buildTaskExecutionError('EXEC_CODE', 'exec msg', false);
        expect(nonRetryable.retryable).toBe(false);
    });

    it('passes context through', () => {
        const error = buildTaskExecutionError('EXEC_CODE', 'msg', false, { taskRunId: 't1' });
        expect(error.context).toEqual({ taskRunId: 't1' });
    });
});
