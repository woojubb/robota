/**
 * Session State Machine
 * 
 * @module SessionStateMachine
 * @description
 * Pure functions for managing session state transitions.
 * Uses state machine pattern to ensure valid state transitions.
 */

import { SessionState } from '../types/session';

/**
 * State transition definition
 */
export interface StateTransition {
    from: SessionState;
    to: SessionState;
    action: string;
    condition?: (context: any) => boolean;
}

/**
 * State transition result
 */
export interface TransitionResult {
    success: boolean;
    newState?: SessionState;
    error?: string;
}

/**
 * Valid state transitions for session lifecycle
 */
const STATE_TRANSITIONS: StateTransition[] = [
    // From ACTIVE
    { from: SessionState.ACTIVE, to: SessionState.PAUSED, action: 'pause' },
    { from: SessionState.ACTIVE, to: SessionState.ARCHIVED, action: 'archive' },
    { from: SessionState.ACTIVE, to: SessionState.TERMINATED, action: 'terminate' },

    // From PAUSED
    { from: SessionState.PAUSED, to: SessionState.ACTIVE, action: 'resume' },
    { from: SessionState.PAUSED, to: SessionState.ARCHIVED, action: 'archive' },
    { from: SessionState.PAUSED, to: SessionState.TERMINATED, action: 'terminate' },

    // From ARCHIVED
    { from: SessionState.ARCHIVED, to: SessionState.ACTIVE, action: 'restore' },
    { from: SessionState.ARCHIVED, to: SessionState.TERMINATED, action: 'terminate' },

    // TERMINATED is final state - no transitions allowed
];

/**
 * Check if a state transition is valid
 * 
 * @param currentState - Current session state
 * @param targetState - Target session state
 * @param action - Action being performed
 * @param context - Optional context for condition checking
 * @returns True if transition is valid
 */
export function isValidTransition(
    currentState: SessionState,
    targetState: SessionState,
    action: string,
    context?: any
): boolean {
    // Same state transition is always valid
    if (currentState === targetState) {
        return true;
    }

    const transition = STATE_TRANSITIONS.find(t =>
        t.from === currentState &&
        t.to === targetState &&
        t.action === action
    );

    if (!transition) {
        return false;
    }

    // Check condition if provided
    if (transition.condition && context) {
        return transition.condition(context);
    }

    return true;
}

/**
 * Attempt to transition to a new state
 * 
 * @param currentState - Current session state
 * @param targetState - Target session state
 * @param action - Action being performed
 * @param context - Optional context for condition checking
 * @returns Transition result
 */
export function attemptTransition(
    currentState: SessionState,
    targetState: SessionState,
    action: string,
    context?: any
): TransitionResult {
    if (!isValidTransition(currentState, targetState, action, context)) {
        return {
            success: false,
            error: `Invalid state transition: ${currentState} -> ${targetState} (action: ${action})`
        };
    }

    return {
        success: true,
        newState: targetState
    };
}

/**
 * Get all possible next states from current state
 * 
 * @param currentState - Current session state
 * @returns Array of possible next states with their actions
 */
export function getPossibleTransitions(currentState: SessionState): Array<{ state: SessionState; action: string }> {
    return STATE_TRANSITIONS
        .filter(t => t.from === currentState)
        .map(t => ({ state: t.to, action: t.action }));
}

/**
 * Check if a state is a final state (no transitions possible)
 * 
 * @param state - State to check
 * @returns True if state is final
 */
export function isFinalState(state: SessionState): boolean {
    return state === SessionState.TERMINATED;
}

/**
 * Check if a state allows active operations
 * 
 * @param state - State to check
 * @returns True if state allows active operations
 */
export function isActiveState(state: SessionState): boolean {
    return state === SessionState.ACTIVE;
}

/**
 * Check if a state allows modifications
 * 
 * @param state - State to check
 * @returns True if state allows modifications
 */
export function allowsModifications(state: SessionState): boolean {
    return state === SessionState.ACTIVE || state === SessionState.PAUSED;
}

/**
 * Get human-readable state description
 * 
 * @param state - Session state
 * @returns Human-readable description
 */
export function getStateDescription(state: SessionState): string {
    const descriptions: Record<SessionState, string> = {
        [SessionState.ACTIVE]: 'Session is active and ready for interactions',
        [SessionState.PAUSED]: 'Session is paused and can be resumed',
        [SessionState.ARCHIVED]: 'Session is archived for long-term storage',
        [SessionState.TERMINATED]: 'Session is permanently terminated'
    };

    return descriptions[state];
}

/**
 * Validate state transition chain
 * 
 * @param transitions - Array of state transitions to validate
 * @returns Validation result with any errors
 */
export function validateTransitionChain(
    transitions: Array<{ from: SessionState; to: SessionState; action: string }>
): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < transitions.length; i++) {
        const transition = transitions[i];

        if (!isValidTransition(transition.from, transition.to, transition.action)) {
            errors.push(
                `Step ${i + 1}: Invalid transition ${transition.from} -> ${transition.to} (${transition.action})`
            );
        }

        // Check if previous transition's end state matches current start state
        if (i > 0 && transitions[i - 1].to !== transition.from) {
            errors.push(
                `Step ${i + 1}: State mismatch - previous step ended at ${transitions[i - 1].to}, current step starts at ${transition.from}`
            );
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
} 