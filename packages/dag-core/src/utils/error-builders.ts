import type { IDagError, TErrorCategory } from '../types/error.js';

export function buildDagError(
    category: TErrorCategory,
    code: string,
    message: string,
    retryable: boolean,
    context?: Record<string, string | number | boolean>
): IDagError {
    return {
        code,
        category,
        message,
        retryable,
        context
    };
}

export function buildValidationError(
    code: string,
    message: string,
    context?: Record<string, string | number | boolean>
): IDagError {
    return buildDagError('validation', code, message, false, context);
}

export function buildDispatchError(
    code: string,
    message: string,
    context?: Record<string, string | number | boolean>
): IDagError {
    return buildDagError('dispatch', code, message, true, context);
}

export function buildLeaseError(
    code: string,
    message: string,
    context?: Record<string, string | number | boolean>
): IDagError {
    return buildDagError('lease', code, message, false, context);
}

export function buildTaskExecutionError(
    code: string,
    message: string,
    retryable: boolean,
    context?: Record<string, string | number | boolean>
): IDagError {
    return buildDagError('task_execution', code, message, retryable, context);
}
