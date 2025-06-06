import type {
    Session,
    SessionConfig,
    SessionMetadata,
    SessionStats
} from '../types/session';
import { SessionState } from '../types/session';
import type { ChatInstance, ChatConfig } from '../types/chat';
import { ChatInstanceImpl } from '../chat/chat-instance';
import { v4 as uuidv4 } from 'uuid';

// Import state machine and utilities
import {
    attemptTransition,
    isActiveState,
    allowsModifications,
    isFinalState
} from '../state/session-state-machine';
import {
    SessionErrorKey,
    SessionOperationError,
    StateTransitionError
} from '../constants/error-messages';
import {
    mergeWithDefaults,
    createInitialMetadata,
    updateTimestamps,
    calculateSessionStats,
    findNextActiveChat,
    wouldExceedChatLimit,
    validateSessionConfig,
    isSessionModifiable
} from '../utils/session-utils';

/**
 * Improved Session Implementation
 * 
 * Uses state machine pattern and pure functions for better maintainability
 */
export class SessionImpl implements Session {
    public readonly metadata: SessionMetadata;
    public readonly config: SessionConfig;

    private readonly _chats: Map<string, ChatInstance> = new Map();
    private _activeChatId?: string;
    private readonly _startTime: Date;

    constructor(
        userId: string,
        config: SessionConfig = {}
    ) {
        // Validate configuration
        const validation = validateSessionConfig(config);
        if (!validation.valid) {
            throw new SessionOperationError(SessionErrorKey.INVALID_CONFIG, {
                reason: validation.errors.map(e => e.message).join(', ')
            });
        }

        this._startTime = new Date();
        const mergedConfig = mergeWithDefaults(config);

        this.config = mergedConfig;
        this.metadata = createInitialMetadata(uuidv4(), userId, mergedConfig);
    }

    // Chat Management - using pure functions
    async createNewChat(config?: ChatConfig): Promise<ChatInstance> {
        this._ensureOperationAllowed('createNewChat');
        this._updateLastAccessed();

        if (wouldExceedChatLimit(this.metadata.chatCount, this.config.maxChats!)) {
            throw new SessionOperationError(SessionErrorKey.MAX_CHATS_REACHED, {
                maxChats: this.config.maxChats
            });
        }

        const chat = new ChatInstanceImpl(
            this.metadata.sessionId,
            config,
            config?.robotaConfig
        );

        this._chats.set(chat.metadata.chatId, chat);
        this.metadata.chatCount++;

        // Auto-activate first chat
        if (this.metadata.chatCount === 1) {
            await this._setActiveChat(chat.metadata.chatId);
        }

        return chat;
    }

    getChat(chatId: string): ChatInstance | undefined {
        return this._chats.get(chatId);
    }

    getAllChats(): ChatInstance[] {
        return Array.from(this._chats.values());
    }

    async switchToChat(chatId: string): Promise<void> {
        this._ensureOperationAllowed('switchToChat');
        this._updateLastAccessed();

        const chat = this._chats.get(chatId);
        if (!chat) {
            throw new SessionOperationError(SessionErrorKey.CHAT_NOT_FOUND, { chatId });
        }

        await this._setActiveChat(chatId);
    }

    async removeChat(chatId: string): Promise<void> {
        this._ensureOperationAllowed('removeChat');
        this._updateLastAccessed();

        const chat = this._chats.get(chatId);
        if (!chat) {
            throw new SessionOperationError(SessionErrorKey.CHAT_NOT_FOUND, { chatId });
        }

        // Determine next active chat using pure function
        const nextActiveChatId = findNextActiveChat(this._chats, chatId, this._activeChatId);

        // Remove the chat
        this._chats.delete(chatId);
        this.metadata.chatCount--;

        // Update active chat
        if (nextActiveChatId) {
            await this._setActiveChat(nextActiveChatId);
        } else {
            this._activeChatId = undefined;
            this.metadata.activeChatId = undefined;
        }
    }

    getActiveChat(): ChatInstance | undefined {
        if (!this._activeChatId) {
            return undefined;
        }
        return this._chats.get(this._activeChatId);
    }

    // Session State Management - using state machine
    async pause(): Promise<void> {
        await this._transitionState(SessionState.PAUSED, 'pause');
        this._deactivateAllChats();
    }

    async resume(): Promise<void> {
        await this._transitionState(SessionState.ACTIVE, 'resume');

        // Reactivate current chat if available
        if (this._activeChatId) {
            const activeChat = this._chats.get(this._activeChatId);
            if (activeChat) {
                activeChat.activate();
            }
        }
    }

    async archive(): Promise<void> {
        await this._transitionState(SessionState.ARCHIVED, 'archive');
        this._deactivateAllChats();
    }

    async terminate(): Promise<void> {
        await this._transitionState(SessionState.TERMINATED, 'terminate');

        // Clean up all resources
        this._deactivateAllChats();
        this._chats.clear();
        this._activeChatId = undefined;
        this.metadata.activeChatId = undefined;
        this.metadata.chatCount = 0;
    }

    // Lifecycle
    async save(): Promise<void> {
        this.metadata.updatedAt = new Date();
        // TODO: Implement persistence layer
    }

    async load(): Promise<void> {
        // TODO: Implement persistence layer
    }

    // Utils - using pure functions
    getState(): SessionState {
        return this.metadata.state;
    }

    updateConfig(config: Partial<SessionConfig>): void {
        this._ensureOperationAllowed('updateConfig');

        // Validate new configuration
        const validation = validateSessionConfig(config);
        if (!validation.valid) {
            throw new SessionOperationError(SessionErrorKey.INVALID_CONFIG, {
                reason: validation.errors.map(e => e.message).join(', ')
            });
        }

        Object.assign(this.config, config);

        if (config.sessionName) {
            this.metadata.sessionName = config.sessionName;
        }
        if (config.description !== undefined) {
            this.metadata.description = config.description;
        }

        this._updateLastAccessed();
    }

    getStats(): SessionStats {
        return calculateSessionStats(
            this.metadata,
            this.getAllChats(),
            this._startTime
        );
    }

    // Private helper methods
    private _updateLastAccessed(): void {
        Object.assign(this.metadata, updateTimestamps(this.metadata));
    }

    private async _transitionState(targetState: SessionState, action: string): Promise<void> {
        const result = attemptTransition(this.metadata.state, targetState, action);

        if (!result.success) {
            throw new StateTransitionError(this.metadata.state, targetState, action);
        }

        this.metadata.state = targetState;
        this._updateLastAccessed();
    }

    private async _setActiveChat(chatId: string): Promise<void> {
        // Deactivate current active chat
        if (this._activeChatId) {
            const currentChat = this._chats.get(this._activeChatId);
            if (currentChat) {
                currentChat.deactivate();
            }
        }

        // Activate new chat
        const newChat = this._chats.get(chatId);
        if (newChat && isActiveState(this.metadata.state)) {
            newChat.activate();
        }

        this._activeChatId = chatId;
        this.metadata.activeChatId = chatId;
    }

    private _deactivateAllChats(): void {
        for (const chat of this._chats.values()) {
            chat.deactivate();
        }
    }

    private _ensureOperationAllowed(operation: string): void {
        if (isFinalState(this.metadata.state)) {
            throw new SessionOperationError(SessionErrorKey.SESSION_TERMINATED);
        }

        if (!isSessionModifiable(this.metadata.state)) {
            throw new SessionOperationError(SessionErrorKey.OPERATION_NOT_ALLOWED, {
                operation,
                currentState: this.metadata.state
            });
        }
    }
} 