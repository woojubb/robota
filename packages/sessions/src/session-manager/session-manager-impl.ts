import type {
    SessionManager,
    SessionManagerConfig,
    SessionManagerStats
} from '../types/session-manager';
import type { Session, SessionConfig } from '../types/session';
import { SessionImpl } from '../session/session-impl';
import { v4 as uuidv4 } from 'uuid';

export class SessionManagerImpl implements SessionManager {
    private sessions: Map<string, Session> = new Map();
    private userSessions: Map<string, Set<string>> = new Map();
    private config: SessionManagerConfig;

    constructor(config: SessionManagerConfig = {}) {
        this.config = {
            maxActiveSessions: config.maxActiveSessions || 10, // Reduced from 50 to 10
            autoCleanup: config.autoCleanup ?? true,
            cleanupInterval: config.cleanupInterval || 3600000, // Changed to 1 hour
            memoryThreshold: config.memoryThreshold || 100, // Reduced to 100MB
            storage: config.storage
        };
    }

    async createSession(userId: string, config?: SessionConfig): Promise<Session> {
        // Check user session count limit
        const userSessionIds = this.userSessions.get(userId) || new Set();
        if (userSessionIds.size >= this.config.maxActiveSessions!) {
            throw new Error(`Maximum session count (${this.config.maxActiveSessions}) reached for user ${userId}`);
        }

        // Create new session
        const session = new SessionImpl(userId, config);

        // Save
        this.sessions.set(session.metadata.sessionId, session);

        // Add to user session list
        if (!this.userSessions.has(userId)) {
            this.userSessions.set(userId, new Set());
        }
        this.userSessions.get(userId)!.add(session.metadata.sessionId);

        return session;
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId);
    }

    getUserSessions(userId: string): Session[] {
        const sessionIds = this.userSessions.get(userId) || new Set();
        const sessions: Session[] = [];

        for (const sessionId of sessionIds) {
            const session = this.sessions.get(sessionId);
            if (session) {
                sessions.push(session);
            }
        }

        return sessions;
    }

    async removeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        // End session
        await session.terminate();

        // Remove from storage
        this.sessions.delete(sessionId);

        // Remove from user session list
        const userSessionIds = this.userSessions.get(session.metadata.userId);
        if (userSessionIds) {
            userSessionIds.delete(sessionId);
            if (userSessionIds.size === 0) {
                this.userSessions.delete(session.metadata.userId);
            }
        }
    }

    async pauseSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.pause();
        }
    }

    async resumeSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.resume();
        }
    }

    async archiveSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (session) {
            await session.archive();
        }
    }

    getActiveSessionCount(): number {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (session.getState() === 'active') {
                count++;
            }
        }
        return count;
    }

    // Simplified cleanup logic
    async cleanup(): Promise<void> {
        if (!this.config.autoCleanup) {
            return;
        }

        // Remove sessions inactive for more than 7 days (reduced from 30 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const sessionsToRemove: string[] = [];

        for (const [sessionId, session] of this.sessions) {
            if (session.metadata.lastAccessedAt < sevenDaysAgo) {
                sessionsToRemove.push(sessionId);
            }
        }

        for (const sessionId of sessionsToRemove) {
            await this.removeSession(sessionId);
        }
    }

    async shutdown(): Promise<void> {
        // Clean up all sessions
        for (const session of this.sessions.values()) {
            await session.terminate();
        }

        this.sessions.clear();
        this.userSessions.clear();
    }

    // Simplified statistics
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
            memoryUsage: 0 // To be implemented later
        };
    }
} 