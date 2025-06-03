import type {
    Session,
    SessionConfig,
    SessionMetadata,
    SessionStats
} from '../types/session';
import { SessionState } from '../types/session';
import type { ChatInstance, ChatConfig } from '../types/chat';
import { ChatInstanceImpl } from '../chat/chat-instance';
import { v4 as uuidv4 } from 'uuid';

export class SessionImpl implements Session {
    public readonly metadata: SessionMetadata;
    public readonly config: SessionConfig;

    private chats: Map<string, ChatInstance> = new Map();
    private activeChatId?: string;
    private _startTime: Date;

    constructor(
        userId: string,
        config: SessionConfig = {}
    ) {
        this._startTime = new Date();

        this.config = {
            sessionName: config.sessionName || `Session ${new Date().getTime()}`,
            description: config.description,
            autoSave: false, // 기본값 false로 변경
            saveInterval: config.saveInterval || 300000,
            maxChats: config.maxChats || 20, // 50에서 20으로 줄임
            retentionPeriod: config.retentionPeriod || 30
        };

        this.metadata = {
            sessionId: uuidv4(),
            userId,
            sessionName: this.config.sessionName!,
            description: this.config.description,
            createdAt: this._startTime,
            updatedAt: this._startTime,
            lastAccessedAt: this._startTime,
            state: SessionState.ACTIVE,
            chatCount: 0,
            activeChatId: undefined
        };
    }

    // Chat Management - 간소화
    async createNewChat(config?: ChatConfig): Promise<ChatInstance> {
        this._updateLastAccessed();

        if (this.metadata.chatCount >= (this.config.maxChats || 20)) {
            throw new Error(`최대 채팅 수 (${this.config.maxChats})에 도달했습니다`);
        }

        const chat = new ChatInstanceImpl(
            this.metadata.sessionId,
            config,
            config?.robotaConfig
        );

        this.chats.set(chat.metadata.chatId, chat);
        this.metadata.chatCount++;

        // 첫 번째 채팅이면 자동으로 활성화
        if (this.metadata.chatCount === 1) {
            await this.switchToChat(chat.metadata.chatId);
        }

        return chat;
    }

    getChat(chatId: string): ChatInstance | undefined {
        return this.chats.get(chatId);
    }

    getAllChats(): ChatInstance[] {
        return Array.from(this.chats.values());
    }

    async switchToChat(chatId: string): Promise<void> {
        this._updateLastAccessed();

        const chat = this.chats.get(chatId);
        if (!chat) {
            throw new Error(`채팅 ID ${chatId}를 찾을 수 없습니다`);
        }

        // 기존 활성 채팅 비활성화
        if (this.activeChatId) {
            const currentChat = this.chats.get(this.activeChatId);
            if (currentChat) {
                currentChat.deactivate();
            }
        }

        // 새 채팅 활성화
        chat.activate();
        this.activeChatId = chatId;
        this.metadata.activeChatId = chatId;
    }

    async removeChat(chatId: string): Promise<void> {
        this._updateLastAccessed();

        const chat = this.chats.get(chatId);
        if (!chat) {
            throw new Error(`채팅 ID ${chatId}를 찾을 수 없습니다`);
        }

        // 활성 채팅이면 다른 채팅으로 전환하거나 비활성화
        if (this.activeChatId === chatId) {
            const remainingChats = Array.from(this.chats.keys()).filter(id => id !== chatId);
            if (remainingChats.length > 0) {
                await this.switchToChat(remainingChats[0]);
            } else {
                this.activeChatId = undefined;
                this.metadata.activeChatId = undefined;
            }
        }

        this.chats.delete(chatId);
        this.metadata.chatCount--;
    }

    getActiveChat(): ChatInstance | undefined {
        if (!this.activeChatId) {
            return undefined;
        }
        return this.chats.get(this.activeChatId);
    }

    // Session State Management - 간소화
    async pause(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.PAUSED;

        // 모든 채팅 비활성화
        for (const chat of this.chats.values()) {
            chat.deactivate();
        }
    }

    async resume(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.ACTIVE;

        // 활성 채팅이 있으면 다시 활성화
        if (this.activeChatId) {
            const activeChat = this.chats.get(this.activeChatId);
            if (activeChat) {
                activeChat.activate();
            }
        }
    }

    async archive(): Promise<void> {
        this._updateLastAccessed();
        this.metadata.state = SessionState.ARCHIVED;

        // 모든 채팅 비활성화
        for (const chat of this.chats.values()) {
            chat.deactivate();
        }
    }

    async terminate(): Promise<void> {
        this.metadata.state = SessionState.TERMINATED;

        // 모든 채팅 정리
        for (const chat of this.chats.values()) {
            chat.deactivate();
        }
        this.chats.clear();
        this.activeChatId = undefined;
        this.metadata.activeChatId = undefined;
        this.metadata.chatCount = 0;
    }

    // Lifecycle - 단순화
    async save(): Promise<void> {
        this.metadata.updatedAt = new Date();
    }

    async load(): Promise<void> {
        // 스토리지 구현 시 추가
    }

    // Utils
    getState(): SessionState {
        return this.metadata.state;
    }

    updateConfig(config: Partial<SessionConfig>): void {
        Object.assign(this.config, config);

        if (config.sessionName) {
            this.metadata.sessionName = config.sessionName;
        }
        if (config.description !== undefined) {
            this.metadata.description = config.description;
        }

        this._updateLastAccessed();
    }

    getStats(): SessionStats {
        let totalMessages = 0;
        for (const chat of this.chats.values()) {
            totalMessages += chat.metadata.messageCount;
        }

        return {
            chatCount: this.metadata.chatCount,
            totalMessages,
            memoryUsage: 0, // 나중에 구현
            diskUsage: 0, // 나중에 구현
            createdAt: this.metadata.createdAt,
            lastActivity: this.metadata.lastAccessedAt,
            uptime: Date.now() - this._startTime.getTime()
        };
    }

    private _updateLastAccessed(): void {
        this.metadata.lastAccessedAt = new Date();
        this.metadata.updatedAt = new Date();
    }
} 