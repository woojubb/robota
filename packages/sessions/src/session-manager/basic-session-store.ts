import type { SessionInfo } from '../types/core';

export interface SessionStore {
    save(session: SessionInfo): Promise<void>;
    load(sessionId: string): Promise<SessionInfo | null>;
    delete(sessionId: string): Promise<boolean>;
    list(userId?: string): Promise<SessionInfo[]>;
    exists(sessionId: string): Promise<boolean>;
    clear(): Promise<void>;
}

export class BasicSessionStore implements SessionStore {
    private sessions: Map<string, SessionInfo> = new Map();

    async save(session: SessionInfo): Promise<void> {
        this.sessions.set(session.id, { ...session });
    }

    async load(sessionId: string): Promise<SessionInfo | null> {
        const session = this.sessions.get(sessionId);
        return session ? { ...session } : null;
    }

    async delete(sessionId: string): Promise<boolean> {
        return this.sessions.delete(sessionId);
    }

    async list(userId?: string): Promise<SessionInfo[]> {
        const sessions = Array.from(this.sessions.values());

        if (userId) {
            return sessions.filter(session => session.userId === userId);
        }

        return sessions;
    }

    async exists(sessionId: string): Promise<boolean> {
        return this.sessions.has(sessionId);
    }

    async clear(): Promise<void> {
        this.sessions.clear();
    }

    // Additional utility methods for in-memory store
    size(): number {
        return this.sessions.size;
    }

    getAllSessions(): SessionInfo[] {
        return Array.from(this.sessions.values());
    }
} 