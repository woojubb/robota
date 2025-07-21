/**
 * Type Guards - Project Compliant Pattern
 * 
 * Follows project's strict no-unknown policy while maintaining type safety
 */

import type { BasicMessage, ResponseMessage } from '../types/message-types';
import type { HttpResponse, HttpError } from '../types/http-types';

// Project-compliant input type (unknown is banned by project rules)
export type ValidatedInput = string | number | boolean | object | null;

/**
 * Type guard for basic message - Project Compliant
 */
export function isBasicMessage(value: ValidatedInput): value is BasicMessage {
    return (
        typeof value === 'object' &&
        value !== null &&
        'role' in value &&
        'content' in value &&
        typeof (value as Record<string, string>).role === 'string' &&
        typeof (value as Record<string, string>).content === 'string'
    );
}

/**
 * Type guard for response message - Project Compliant
 */
export function isResponseMessage(value: ValidatedInput): value is ResponseMessage {
    return (
        isBasicMessage(value) &&
        'timestamp' in value &&
        (value as Record<string, Date>).timestamp instanceof Date
    );
}

/**
 * Type guard for HTTP response - Project Compliant
 */
export function isHttpResponse<TData>(value: ValidatedInput): value is HttpResponse<TData> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        'status' in value &&
        'headers' in value &&
        'data' in value &&
        'timestamp' in value &&
        typeof (value as Record<string, string | number | Date>).id === 'string' &&
        typeof (value as Record<string, string | number | Date>).status === 'number' &&
        typeof (value as Record<string, string | number | Date>).headers === 'object' &&
        (value as Record<string, string | number | Date>).timestamp instanceof Date
    );
}

/**
 * Type guard for HTTP error - Project Compliant
 */
export function isHttpError(value: ValidatedInput): value is HttpError {
    return (
        typeof value === 'object' &&
        value !== null &&
        'code' in value &&
        'message' in value &&
        typeof (value as Record<string, string>).code === 'string' &&
        typeof (value as Record<string, string>).message === 'string'
    );
}

/**
 * Type guard for string - Project Compliant
 */
export function isString(value: ValidatedInput): value is string {
    return typeof value === 'string';
}

/**
 * Type guard for number - Project Compliant
 */
export function isNumber(value: ValidatedInput): value is number {
    return typeof value === 'number' && !isNaN(value);
}

/**
 * Type guard for object - Project Compliant
 */
export function isObject(value: ValidatedInput): value is Record<string, string | number | boolean> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
} 