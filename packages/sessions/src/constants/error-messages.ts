/**
 * Error Messages Constants
 * 
 * @module ErrorMessages
 * @description
 * Centralized error messages for consistent error handling.
 * Supports internationalization and message formatting.
 */

import { SessionState } from '../types/session';

/**
 * Session error message keys
 */
export enum SessionErrorKey {
    MAX_CHATS_REACHED = 'MAX_CHATS_REACHED',
    CHAT_NOT_FOUND = 'CHAT_NOT_FOUND',
    INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',
    OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',
    SESSION_TERMINATED = 'SESSION_TERMINATED',
    INVALID_CONFIG = 'INVALID_CONFIG',
    SAVE_FAILED = 'SAVE_FAILED',
    LOAD_FAILED = 'LOAD_FAILED'
}

/**
 * Error message templates
 */
const ERROR_MESSAGES: Record<SessionErrorKey, string> = {
    [SessionErrorKey.MAX_CHATS_REACHED]: 'Maximum number of chats ({maxChats}) reached',
    [SessionErrorKey.CHAT_NOT_FOUND]: 'Chat with ID "{chatId}" not found',
    [SessionErrorKey.INVALID_STATE_TRANSITION]: 'Invalid state transition from {currentState} to {targetState}',
    [SessionErrorKey.OPERATION_NOT_ALLOWED]: 'Operation "{operation}" not allowed in state {currentState}',
    [SessionErrorKey.SESSION_TERMINATED]: 'Session is terminated and cannot be modified',
    [SessionErrorKey.INVALID_CONFIG]: 'Invalid configuration: {reason}',
    [SessionErrorKey.SAVE_FAILED]: 'Failed to save session: {reason}',
    [SessionErrorKey.LOAD_FAILED]: 'Failed to load session: {reason}'
};

/**
 * Get formatted error message
 * 
 * @param key - Error message key
 * @param params - Message parameters for substitution
 * @returns Formatted error message
 */
export function getErrorMessage(key: SessionErrorKey, params: Record<string, any> = {}): string {
    let message = ERROR_MESSAGES[key];

    // Replace placeholders with actual values
    for (const [paramKey, paramValue] of Object.entries(params)) {
        message = message.replace(`{${paramKey}}`, String(paramValue));
    }

    return message;
}

/**
 * Create session error with formatted message
 * 
 * @param key - Error message key
 * @param params - Message parameters
 * @returns Error instance
 */
export function createSessionError(key: SessionErrorKey, params: Record<string, any> = {}): Error {
    const message = getErrorMessage(key, params);
    const error = new Error(message);
    error.name = 'SessionError';
    return error;
}

/**
 * Session operation error class
 */
export class SessionOperationError extends Error {
    public readonly code: SessionErrorKey;
    public readonly context: Record<string, any>;

    constructor(code: SessionErrorKey, context: Record<string, any> = {}) {
        const message = getErrorMessage(code, context);
        super(message);
        this.name = 'SessionOperationError';
        this.code = code;
        this.context = context;
    }
}

/**
 * State transition error class
 */
export class StateTransitionError extends SessionOperationError {
    public readonly currentState: SessionState;
    public readonly targetState: SessionState;
    public readonly action: string;

    constructor(
        currentState: SessionState,
        targetState: SessionState,
        action: string
    ) {
        super(SessionErrorKey.INVALID_STATE_TRANSITION, {
            currentState,
            targetState,
            action
        });

        this.currentState = currentState;
        this.targetState = targetState;
        this.action = action;
    }
}

/**
 * Validation error utilities
 */
export class ValidationError extends Error {
    public readonly field: string;
    public readonly value: any;
    public readonly constraint: string;

    constructor(field: string, value: any, constraint: string) {
        super(`Validation failed for field "${field}": ${constraint} (got: ${value})`);
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
        this.constraint = constraint;
    }
}

/**
 * Common validation constraints
 */
export const ValidationConstraints = {
    required: (field: string) => `${field} is required`,
    minLength: (field: string, min: number) => `${field} must be at least ${min} characters`,
    maxLength: (field: string, max: number) => `${field} must be at most ${max} characters`,
    positive: (field: string) => `${field} must be a positive number`,
    range: (field: string, min: number, max: number) => `${field} must be between ${min} and ${max}`
} as const;
