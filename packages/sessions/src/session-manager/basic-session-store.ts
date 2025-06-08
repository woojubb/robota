import type { SessionInfo } from '../types/core';

/**
 * Interface for session storage implementations
 * 
 * Defines the contract for storing and retrieving session information.
 * Implementations can vary from in-memory storage to database persistence.
 * 
 * @public
 */
export interface SessionStore {
    /**
     * Save a session to the store
     * 
     * @param session - Session information to save
     */
    save(session: SessionInfo): Promise<void>;

    /**
     * Load a session from the store
     * 
     * @param sessionId - Unique session identifier
     * @returns Session information or null if not found
     */
    load(sessionId: string): Promise<SessionInfo | null>;

    /**
     * Delete a session from the store
     * 
     * @param sessionId - Unique session identifier
     * @returns True if session was deleted, false if not found
     */
    delete(sessionId: string): Promise<boolean>;

    /**
     * List sessions, optionally filtered by user
     * 
     * @param userId - Optional user ID to filter sessions
     * @returns Array of session information
     */
    list(userId?: string): Promise<SessionInfo[]>;

    /**
     * Check if a session exists in the store
     * 
     * @param sessionId - Unique session identifier
     * @returns True if session exists
     */
    exists(sessionId: string): Promise<boolean>;

    /**
     * Clear all sessions from the store
     */
    clear(): Promise<void>;
}

/**
 * Basic in-memory session store implementation
 * 
 * Provides simple session storage using a Map for development and testing.
 * Sessions are lost when the application restarts. For production use,
 * consider implementing a persistent store using a database.
 * 
 * @see {@link ../../../apps/examples/04-sessions | Session Examples}
 * 
 * @public
 */
export class BasicSessionStore implements SessionStore {
    /** @internal Map storing session data by session ID */
    private sessions: Map<string, SessionInfo> = new Map();

    /**
     * Save a session to the in-memory store
     * 
     * Creates a deep copy to prevent external modifications affecting stored data.
     * 
     * @param session - Session information to save
     */
    async save(session: SessionInfo): Promise<void> {
        this.sessions.set(session.id, { ...session });
    }

    /**
     * Load a session from the in-memory store
     * 
     * Returns a copy to prevent external modifications affecting stored data.
     * 
     * @param sessionId - Unique session identifier
     * @returns Session information or null if not found
     */
    async load(sessionId: string): Promise<SessionInfo | null> {
        const session = this.sessions.get(sessionId);
        return session ? { ...session } : null;
    }

    /**
     * Delete a session from the in-memory store
     * 
     * @param sessionId - Unique session identifier
     * @returns True if session was deleted, false if not found
     */
    async delete(sessionId: string): Promise<boolean> {
        return this.sessions.delete(sessionId);
    }

    /**
     * List sessions, optionally filtered by user
     * 
     * @param userId - Optional user ID to filter sessions
     * @returns Array of session information copies
     */
    async list(userId?: string): Promise<SessionInfo[]> {
        const sessions = Array.from(this.sessions.values());

        if (userId) {
            return sessions.filter(session => session.userId === userId);
        }

        return sessions;
    }

    /**
     * Check if a session exists in the in-memory store
     * 
     * @param sessionId - Unique session identifier
     * @returns True if session exists
     */
    async exists(sessionId: string): Promise<boolean> {
        return this.sessions.has(sessionId);
    }

    /**
     * Clear all sessions from the in-memory store
     */
    async clear(): Promise<void> {
        this.sessions.clear();
    }

    /**
     * Get the current number of stored sessions
     * 
     * Utility method for monitoring and debugging.
     * 
     * @returns Number of sessions in the store
     */
    size(): number {
        return this.sessions.size;
    }

    /**
     * Get all sessions as an array
     * 
     * Utility method for bulk operations and debugging.
     * Returns copies to prevent external modifications.
     * 
     * @returns Array of all session information
     */
    getAllSessions(): SessionInfo[] {
        return Array.from(this.sessions.values());
    }
} 