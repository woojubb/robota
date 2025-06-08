import type { Session, SessionConfig } from './session';

export interface SessionManagerConfig {
    maxActiveSessions?: number;
    autoCleanup?: boolean;
    cleanupInterval?: number; // milliseconds
    memoryThreshold?: number; // MB
    storage?: any; // To be implemented later
}

export interface SessionManager {
    createSession(userId: string, config?: SessionConfig): Promise<Session>;
    getSession(sessionId: string): Session | undefined;
    getUserSessions(userId: string): Session[];
    removeSession(sessionId: string): Promise<void>;
    pauseSession(sessionId: string): Promise<void>;
    resumeSession(sessionId: string): Promise<void>;
    archiveSession(sessionId: string): Promise<void>;
    getActiveSessionCount(): number;
    cleanup(): Promise<void>;
    shutdown(): Promise<void>;
}

export interface SessionManagerStats {
    totalSessions: number;
    activeSessions: number;
    pausedSessions: number;
    archivedSessions: number;
    memoryUsage: number; // MB
}

export interface SessionManagerEvents {
    'session:created': (session: Session) => void;
    'session:removed': (sessionId: string) => void;
    'session:paused': (sessionId: string) => void;
    'session:resumed': (sessionId: string) => void;
    'session:archived': (sessionId: string) => void;
    'memory:threshold-exceeded': (stats: SessionManagerStats) => void;
    'cleanup:completed': (removedCount: number) => void;
} 