import { Session } from './session';
import type {
    SessionManager as ISessionManager,
    SessionManagerConfig,
    SessionManagerStats,
    SessionConfig,
    Session as ISession
} from './types';

/**
 * SessionManager - Multi-User Session Management
 * 
 * @description
 * A simplified session manager that handles multiple user sessions.
 * Similar to team management but focused on session lifecycle management.
 */
export class SessionManager implements ISessionManager {
    private sessions: Map<string, Session> = new Map();
    private userSessions: Map<string, Set<string>> = new Map();
    private config: Required<SessionManagerConfig>;
    private cleanupTimer?: NodeJS.Timeout;

    /**
     * Create a SessionManager instance
     */
    constructor(config: SessionManagerConfig = {}) {
        this.config = {
            maxActiveSessions: config.maxActiveSessions || 50,
            autoCleanup: config.autoCleanup ?? true,
            cleanupInterval: config.cleanupInterval || 3600000, // 1 hour
            memoryThreshold: config.memoryThreshold || 500, // 500MB
            debug: config.debug || false
        };

        // Start cleanup timer if enabled
        if (this.config.autoCleanup) {
            this.cleanupTimer = setInterval(() => {
                this.cleanup().catch(error => {
                    if (this.config.debug) {
                        console.error('SessionManager: Cleanup error:', error);
                    }
                });
            }, this.config.cleanupInterval);
        }

        if (this.config.debug) {
            console.log('SessionManager: Initialized with config:', this.config);
        }
    }

    /**
     * Create a new session for a user
     */
    async createSession(userId: string, config?: SessionConfig): Promise<ISession> {
        // Check user session limit
        const userSessionIds = this.userSessions.get(userId) || new Set();
        if (userSessionIds.size >= this.config.maxActiveSessions) {
            throw new Error(`Maximum session count (${this.config.maxActiveSessions}) reached for user ${userId}`);
        }

        // Create new session
        const session = new Session(userId, config);

        // Register session
        this.sessions.set(session.metadata.sessionId, session);

        // Add to user session tracking
        if (!this.userSessions.has(userId)) {
            this.userSessions.set(userId, new Set());
        }
        this.userSessions.get(userId)!.add(session.metadata.sessionId);

        if (this.config.debug) {
            console.log(`SessionManager: Created session ${session.metadata.sessionId} for user ${userId}`);
        }

        return session;
    }

    /**
     * Get a session by ID
     */
    getSession(sessionId: string): ISession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Get all sessions for a user
     */
    getUserSessions(userId: string): ISession[] {
        const sessionIds = this.userSessions.get(userId) || new Set();
        const sessions: ISession[] = [];

        for (const sessionId of sessionIds) {
            const session = this.sessions.get(sessionId);
            if (session) {
                sessions.push(session);
            }
        }

        return sessions;
    }

    /**
     * Remove a session
     */
    async removeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            if (this.config.debug) {
                console.log(`SessionManager: Session ${sessionId} not found for removal`);
            }
            return;
        }

        // Terminate the session
        await session.terminate();

        // Remove from collections
        this.sessions.delete(sessionId);

        // Remove from user session tracking
        const userSessionIds = this.userSessions.get(session.metadata.userId);
        if (userSessionIds) {
            userSessionIds.delete(sessionId);
            if (userSessionIds.size === 0) {
                this.userSessions.delete(session.metadata.userId);
            }
        }

        if (this.config.debug) {
            console.log(`SessionManager: Removed session ${sessionId}`);
        }
    }

    /**
     * Pause a session
     */
    async pauseSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.pause();

            if (this.config.debug) {
                console.log(`SessionManager: Paused session ${sessionId}`);
            }
        }
    }

    /**
     * Resume a session
     */
    async resumeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.resume();

            if (this.config.debug) {
                console.log(`SessionManager: Resumed session ${sessionId}`);
            }
        }
    }

    /**
     * Archive a session
     */
    async archiveSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.archive();

            if (this.config.debug) {
                console.log(`SessionManager: Archived session ${sessionId}`);
            }
        }
    }

    /**
     * Get count of active sessions
     */
    getActiveSessionCount(): number {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.getState() === 'active') {
                count++;
            }
        }
        return count;
    }

    /**
     * Cleanup inactive sessions
     */
    async cleanup(): Promise<void> {
        if (!this.config.autoCleanup) {
            return;
        }

        const now = Date.now();
        const cleanupThreshold = 24 * 60 * 60 * 1000; // 24 hours
        const sessionsToRemove: string[] = [];

        // Find sessions to cleanup
        for (const [sessionId, session] of this.sessions) {
            const lastAccessed = session.metadata.lastAccessedAt.getTime();
            const timeSinceAccess = now - lastAccessed;

            // Remove sessions that haven't been accessed in 24 hours
            if (timeSinceAccess > cleanupThreshold) {
                sessionsToRemove.push(sessionId);
            }
        }

        // Remove identified sessions
        for (const sessionId of sessionsToRemove) {
            await this.removeSession(sessionId);
        }

        if (this.config.debug && sessionsToRemove.length > 0) {
            console.log(`SessionManager: Cleaned up ${sessionsToRemove.length} inactive sessions`);
        }
    }

    /**
     * Shutdown the session manager
     */
    async shutdown(): Promise<void> {
        // Stop cleanup timer
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        // Terminate all sessions
        const sessionIds = Array.from(this.sessions.keys());
        for (const sessionId of sessionIds) {
            await this.removeSession(sessionId);
        }

        if (this.config.debug) {
            console.log('SessionManager: Shutdown completed');
        }
    }

    /**
     * Get session manager statistics
     */
    getStats(): SessionManagerStats {
        let activeSessions = 0;
        let pausedSessions = 0;
        let archivedSessions = 0;

        for (const session of this.sessions.values()) {
            switch (session.getState()) {
                case 'active':
                    activeSessions++;
                    break;
                case 'paused':
                    pausedSessions++;
                    break;
                case 'archived':
                    archivedSessions++;
                    break;
            }
        }

        return {
            totalSessions: this.sessions.size,
            activeSessions,
            pausedSessions,
            archivedSessions,
            memoryUsage: this._estimateMemoryUsage()
        };
    }

    /**
     * Estimate memory usage (simplified)
     */
    private _estimateMemoryUsage(): number {
        // Simple estimation based on session count
        // In a real implementation, this would use process.memoryUsage()
        return this.sessions.size * 0.1; // Assume ~0.1MB per session
    }
} 