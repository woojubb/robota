// 간결한 핵심 타입 정의
export enum SessionState {
    ACTIVE = 'active',
    PAUSED = 'paused',
    TERMINATED = 'terminated'
}

// 세션 관련 타입
export interface SessionConfig {
    name?: string;
    maxChats?: number;
}

export interface SessionInfo {
    id: string;
    userId: string;
    name: string;
    state: SessionState;
    chatCount: number;
    activeChatId?: string;
    createdAt: Date;
    lastUsedAt: Date;
}

// 채팅 관련 타입
export interface ChatConfig {
    name?: string;
    robotaConfig?: any;
}

export interface ChatInfo {
    id: string;
    sessionId: string;
    name: string;
    isActive: boolean;
    messageCount: number;
    createdAt: Date;
    lastUsedAt: Date;
}

// 매니저 설정
export interface SessionManagerConfig {
    maxSessions?: number;
    autoCleanupDays?: number;
} 