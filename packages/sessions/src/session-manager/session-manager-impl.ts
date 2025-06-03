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
    private config: SessionManagerConfig & {
        maxActiveSessions: number;
        autoCleanup: boolean;
        cleanupInterval: number;
        memoryThreshold: number;
    };

    constructor(config: SessionManagerConfig = {}) {
        this.config = {
            ...config,
            maxActiveSessions: config.maxActiveSessions || 50,
            autoCleanup: config.autoCleanup ?? true,
            cleanupInterval: config.cleanupInterval || 300000, // 5분
            memoryThreshold: config.memoryThreshold || 500, // 500MB
            storage: config.storage
        };
    }

    async createSession(userId: string, config?: SessionConfig): Promise<Session> {
        // 사용자별 세션 수 제한 확인
        const userSessionIds = this.userSessions.get(userId) || new Set();
        if (userSessionIds.size >= this.config.maxActiveSessions) {
            throw new Error(`Maximum sessions (${this.config.maxActiveSessions}) reached for user ${userId}`);
        }

        // 새 세션 생성
        const session = new SessionImpl(userId, config);

        // 저장
        this.sessions.set(session.metadata.sessionId, session);

        // 사용자별 세션 목록에 추가
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

        // 세션 종료
        await session.terminate();

        // 저장소에서 제거
        this.sessions.delete(sessionId);

        // 사용자 세션 목록에서 제거
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

    async cleanup(): Promise<void> {
        if (!this.config.autoCleanup) {
            return;
        }

        // 간단한 정리 로직: 30일 이상 비활성 세션 제거
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const sessionsToRemove: string[] = [];

        for (const [sessionId, session] of this.sessions) {
            if (session.metadata.lastAccessedAt < thirtyDaysAgo) {
                sessionsToRemove.push(sessionId);
            }
        }

        for (const sessionId of sessionsToRemove) {
            await this.removeSession(sessionId);
        }
    }

    async shutdown(): Promise<void> {
        // 모든 세션 정리
        for (const session of this.sessions.values()) {
            await session.terminate();
        }

        this.sessions.clear();
        this.userSessions.clear();
    }

    // 간단한 통계 메서드
    getStats(): SessionManagerStats {
        let totalMemory = 0;
        let activeSessions = 0;
        let pausedSessions = 0;
        let archivedSessions = 0;

        for (const session of this.sessions.values()) {
            const stats = session.getStats();
            totalMemory += stats.memoryUsage;

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
            memoryUsage: totalMemory
        };
    }
} 