/**
 * Session Utilities
 * 
 * @module SessionUtils
 * @description
 * Pure utility functions for session operations.
 * These functions are stateless and reusable.
 */

import type { SessionConfig, SessionMetadata, SessionStats } from '../types/session';
import { SessionState } from '../types/session';
import type { ChatInstance } from '../types/chat';
import { ValidationError, ValidationConstraints } from '../constants/error-messages';

/**
 * Internal default configuration type with all required fields
 */
interface DefaultSessionConfig {
    sessionName: string;
    description?: string;
    autoSave: boolean;
    saveInterval: number;
    maxChats: number;
    retentionPeriod: number;
}

/**
 * Default session configuration
 */
export const DEFAULT_SESSION_CONFIG: DefaultSessionConfig = {
    sessionName: '',
    description: undefined,
    autoSave: false,
    saveInterval: 300000, // 5 minutes
    maxChats: 20,
    retentionPeriod: 30 // days
};

/**
 * Generate default session name based on timestamp
 * 
 * @param timestamp - Optional timestamp (defaults to current time)
 * @returns Generated session name
 */
export function generateDefaultSessionName(timestamp?: Date): string {
    const time = timestamp || new Date();
    return `Session ${time.getTime()}`;
}

/**
 * Validate session configuration
 * 
 * @param config - Configuration to validate
 * @returns Validation result
 */
export function validateSessionConfig(config: SessionConfig): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    // Validate sessionName
    if (config.sessionName !== undefined) {
        if (typeof config.sessionName !== 'string') {
            errors.push(new ValidationError('sessionName', config.sessionName, 'must be a string'));
        } else if (config.sessionName.length === 0) {
            errors.push(new ValidationError('sessionName', config.sessionName, ValidationConstraints.required('sessionName')));
        } else if (config.sessionName.length > 100) {
            errors.push(new ValidationError('sessionName', config.sessionName, ValidationConstraints.maxLength('sessionName', 100)));
        }
    }

    // Validate description
    if (config.description !== undefined && typeof config.description !== 'string') {
        errors.push(new ValidationError('description', config.description, 'must be a string'));
    }

    // Validate maxChats
    if (config.maxChats !== undefined) {
        if (typeof config.maxChats !== 'number' || !Number.isInteger(config.maxChats)) {
            errors.push(new ValidationError('maxChats', config.maxChats, 'must be an integer'));
        } else if (config.maxChats <= 0) {
            errors.push(new ValidationError('maxChats', config.maxChats, ValidationConstraints.positive('maxChats')));
        } else if (config.maxChats > 100) {
            errors.push(new ValidationError('maxChats', config.maxChats, ValidationConstraints.range('maxChats', 1, 100)));
        }
    }

    // Validate saveInterval
    if (config.saveInterval !== undefined) {
        if (typeof config.saveInterval !== 'number' || !Number.isInteger(config.saveInterval)) {
            errors.push(new ValidationError('saveInterval', config.saveInterval, 'must be an integer'));
        } else if (config.saveInterval < 60000) { // minimum 1 minute
            errors.push(new ValidationError('saveInterval', config.saveInterval, 'must be at least 60000ms (1 minute)'));
        }
    }

    // Validate retentionPeriod
    if (config.retentionPeriod !== undefined) {
        if (typeof config.retentionPeriod !== 'number' || !Number.isInteger(config.retentionPeriod)) {
            errors.push(new ValidationError('retentionPeriod', config.retentionPeriod, 'must be an integer'));
        } else if (config.retentionPeriod <= 0) {
            errors.push(new ValidationError('retentionPeriod', config.retentionPeriod, ValidationConstraints.positive('retentionPeriod')));
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Merge session configuration with defaults
 * 
 * @param config - User provided configuration
 * @returns Merged configuration with all required fields
 */
export function mergeWithDefaults(config: SessionConfig): DefaultSessionConfig {
    const merged = { ...DEFAULT_SESSION_CONFIG, ...config };

    // Generate default session name if not provided
    if (!merged.sessionName) {
        merged.sessionName = generateDefaultSessionName();
    }

    return merged;
}

/**
 * Create initial session metadata
 * 
 * @param sessionId - Unique session ID
 * @param userId - User ID
 * @param config - Session configuration
 * @returns Initial metadata
 */
export function createInitialMetadata(
    sessionId: string,
    userId: string,
    config: DefaultSessionConfig
): SessionMetadata {
    const now = new Date();

    return {
        sessionId,
        userId,
        sessionName: config.sessionName,
        description: config.description,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        state: SessionState.ACTIVE,
        chatCount: 0,
        activeChatId: undefined
    };
}

/**
 * Update metadata timestamps
 * 
 * @param metadata - Current metadata
 * @returns Updated metadata with new timestamps
 */
export function updateTimestamps(metadata: SessionMetadata): SessionMetadata {
    const now = new Date();
    return {
        ...metadata,
        lastAccessedAt: now,
        updatedAt: now
    };
}

/**
 * Calculate session statistics
 * 
 * @param metadata - Session metadata
 * @param chats - All chat instances
 * @param startTime - Session start time
 * @returns Calculated statistics
 */
export function calculateSessionStats(
    metadata: SessionMetadata,
    chats: ChatInstance[],
    startTime: Date
): SessionStats {
    let totalMessages = 0;

    for (const chat of chats) {
        totalMessages += chat.metadata.messageCount;
    }

    return {
        chatCount: metadata.chatCount,
        totalMessages,
        memoryUsage: 0, // TODO: Implement memory usage calculation
        diskUsage: 0, // TODO: Implement disk usage calculation
        createdAt: metadata.createdAt,
        lastActivity: metadata.lastAccessedAt,
        uptime: Date.now() - startTime.getTime()
    };
}

/**
 * Find next active chat when current one is removed
 * 
 * @param chats - Map of chat instances
 * @param removedChatId - ID of chat being removed
 * @param currentActiveChatId - Current active chat ID
 * @returns ID of next chat to activate, or undefined if none
 */
export function findNextActiveChat(
    chats: Map<string, ChatInstance>,
    removedChatId: string,
    currentActiveChatId?: string
): string | undefined {
    // If removed chat is not active, keep current active chat
    if (currentActiveChatId !== removedChatId) {
        return currentActiveChatId;
    }

    // Find remaining chats
    const remainingChatIds = Array.from(chats.keys()).filter(id => id !== removedChatId);

    // Return first remaining chat, or undefined if none
    return remainingChatIds.length > 0 ? remainingChatIds[0] : undefined;
}

/**
 * Check if chat limit would be exceeded
 * 
 * @param currentCount - Current number of chats
 * @param maxChats - Maximum allowed chats
 * @returns True if limit would be exceeded
 */
export function wouldExceedChatLimit(currentCount: number, maxChats: number): boolean {
    return currentCount >= maxChats;
}

/**
 * Format uptime duration in human-readable format
 * 
 * @param uptimeMs - Uptime in milliseconds
 * @returns Formatted duration string
 */
export function formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Check if session is in a modifiable state
 * 
 * @param state - Current session state
 * @returns True if session allows modifications
 */
export function isSessionModifiable(state: SessionState): boolean {
    return state === SessionState.ACTIVE || state === SessionState.PAUSED;
}

/**
 * Check if session is active and ready for operations
 * 
 * @param state - Current session state
 * @returns True if session is active
 */
export function isSessionActive(state: SessionState): boolean {
    return state === SessionState.ACTIVE;
} 