// Main classes
export { Session } from './session';
export { SessionManager } from './session-manager';
export { ChatInstance } from './chat-instance';

// Convenience functions
export { createSessionManager, createSimpleSession } from './create-session';

// Types and interfaces
export type {
    SessionConfig,
    ChatConfig,
    SessionMetadata,
    ChatMetadata,
    SessionStats,
    ChatStats,
    SessionManagerConfig,
    SessionManagerStats,
    SessionOptions,
    Session as ISession,
    ChatInstance as IChatInstance,
    SessionManager as ISessionManager
} from './types';

// Enums
export { SessionState, ChatState } from './types'; 