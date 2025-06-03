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
            maxActiveSessions: config.maxActiveSessions || 10, // 50에서 10으로 줄임
            autoCleanup: config.autoCleanup ?? true,
            cleanupInterval: config.cleanupInterval || 3600000, // 1시간으로 변경
            memoryThreshold: config.memoryThreshold || 100, // 100MB로 줄임
            storage: config.storage
        };
    }

    async createSession(userId: string, config?: SessionConfig): Promise<Session> {
        // 사용자별 세션 수 제한 확인
        const userSessionIds = this.userSessions.get(userId) || new Set();
        if (userSessionIds.size >= this.config.maxActiveSessions!) {
            throw new Error(`사용자 ${userId}의 최대 세션 수 (${this.config.maxActiveSessions})에 도달했습니다`);
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

    // 간소화된 정리 로직
    async cleanup(): Promise<void> {
        if (!this.config.autoCleanup) {
            return;
        }

        // 7일 이상 비활성 세션 제거 (30일에서 줄임)
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
        // 모든 세션 정리
        for (const session of this.sessions.values()) {
            await session.terminate();
        }

        this.sessions.clear();
        this.userSessions.clear();
    }

    // 간소화된 통계
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
            memoryUsage: 0 // 나중에 구현
        };
    }
} 