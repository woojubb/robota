import type { Session, SessionState } from './session';
import type { ChatInstance } from './chat';
import type { StorageStats } from './storage';

export enum SessionEventType {
    // Session Events
    SESSION_CREATED = 'session:created',
    SESSION_REMOVED = 'session:removed',
    SESSION_STATE_CHANGED = 'session:state-changed',
    SESSION_CONFIG_UPDATED = 'session:config-updated',

    // Chat Events
    CHAT_CREATED = 'chat:created',
    CHAT_REMOVED = 'chat:removed',
    CHAT_ACTIVATED = 'chat:activated',
    CHAT_DEACTIVATED = 'chat:deactivated',
    CHAT_MESSAGE_SENT = 'chat:message-sent',
    CHAT_CONFIG_UPDATED = 'chat:config-updated',

    // System Events
    MEMORY_THRESHOLD_EXCEEDED = 'memory:threshold-exceeded',
    CLEANUP_COMPLETED = 'cleanup:completed',
    STORAGE_ERROR = 'storage:error',

    // User Events
    USER_SESSION_LIMIT_REACHED = 'user:session-limit-reached'
}

export interface SessionEvent {
    type: SessionEventType;
    timestamp: Date;
    sessionId?: string;
    userId?: string;
    data?: any;
}

export interface SessionCreatedEvent extends SessionEvent {
    type: SessionEventType.SESSION_CREATED;
    sessionId: string;
    userId: string;
    data: {
        session: Session;
        config: any;
    };
}

export interface SessionStateChangedEvent extends SessionEvent {
    type: SessionEventType.SESSION_STATE_CHANGED;
    sessionId: string;
    data: {
        oldState: SessionState;
        newState: SessionState;
        reason?: string;
    };
}

export interface ChatCreatedEvent extends SessionEvent {
    type: SessionEventType.CHAT_CREATED;
    sessionId: string;
    data: {
        chat: ChatInstance;
        config: any;
    };
}

export interface ChatActivatedEvent extends SessionEvent {
    type: SessionEventType.CHAT_ACTIVATED;
    sessionId: string;
    data: {
        chatId: string;
        previousChatId?: string;
    };
}

export interface MemoryThresholdExceededEvent extends SessionEvent {
    type: SessionEventType.MEMORY_THRESHOLD_EXCEEDED;
    data: {
        stats: StorageStats;
        threshold: number;
        usage: number;
    };
}

export interface CleanupCompletedEvent extends SessionEvent {
    type: SessionEventType.CLEANUP_COMPLETED;
    data: {
        sessionsRemoved: number;
        chatsRemoved: number;
        memoryFreed: number; // MB
        duration: number; // ms
    };
}

export type SessionEventHandler<T extends SessionEvent = SessionEvent> = (event: T) => void | Promise<void>;

export interface EventEmitter {
    on<T extends SessionEvent>(eventType: T['type'], handler: SessionEventHandler<T>): void;
    off<T extends SessionEvent>(eventType: T['type'], handler: SessionEventHandler<T>): void;
    emit<T extends SessionEvent>(event: T): Promise<void>;
    removeAllListeners(eventType?: SessionEventType): void;
    listenerCount(eventType: SessionEventType): number;
}

export interface EventFilter {
    types?: SessionEventType[];
    sessionIds?: string[];
    userIds?: string[];
    since?: Date;
    until?: Date;
}

export interface EventLogger {
    log(event: SessionEvent): Promise<void>;
    getEvents(filter?: EventFilter): Promise<SessionEvent[]>;
    cleanup(olderThan: Date): Promise<number>;
} 