import { Robota } from '@robota-sdk/core';
import type {
    ChatInstance,
    ChatConfig,
    ChatMetadata,
    ChatStats,
    MessageContent
} from '../types/chat';
import { v4 as uuidv4 } from 'uuid';

export class ChatInstanceImpl implements ChatInstance {
    public readonly metadata: ChatMetadata;
    public readonly config: ChatConfig;
    public readonly robota: Robota;

    private _isActive: boolean = false;
    private _startTime: Date;

    constructor(
        sessionId: string,
        config: ChatConfig = {},
        robotaConfig?: any
    ) {
        this._startTime = new Date();

        this.config = {
            chatName: config.chatName || `Chat ${new Date().getTime()}`,
            description: config.description,
            robotaConfig: config.robotaConfig || robotaConfig,
            autoSave: config.autoSave ?? false,
            maxHistorySize: config.maxHistorySize || 1000
        };

        this.metadata = {
            chatId: uuidv4(),
            sessionId,
            chatName: this.config.chatName!,
            description: this.config.description,
            createdAt: this._startTime,
            updatedAt: this._startTime,
            lastAccessedAt: this._startTime,
            messageCount: 0,
            isActive: false
        };

        this.robota = new Robota({
            ...this.config.robotaConfig
        });
    }

    // Chat Operations
    async sendMessage(content: MessageContent): Promise<string> {
        this._updateLastAccessed();

        const messageText = typeof content === 'string' ? content : content.text || '';

        try {
            const response = await this.robota.run(messageText);

            this.metadata.messageCount = this.robota.limits.getCurrentRequestCount();

            return response;
        } catch (error) {
            throw new Error(`Failed to send message: ${error}`);
        }
    }

    // State Management
    activate(): void {
        this._isActive = true;
        this.metadata.isActive = true;
        this._updateLastAccessed();
    }

    deactivate(): void {
        this._isActive = false;
        this.metadata.isActive = false;
    }

    // History Management
    clearHistory(): void {
        this.robota.conversation.clear();
        this.metadata.messageCount = 0;
        this._updateLastAccessed();
    }

    // Simplified methods
    async updateRobotaConfig(config: any): Promise<void> {
        this._updateLastAccessed();
        this.config.robotaConfig = { ...this.config.robotaConfig, ...config };
    }

    getRobotaConfig(): any {
        return this.config.robotaConfig;
    }

    // Complex features not yet implemented
    async regenerateResponse(): Promise<string> {
        throw new Error('Not yet implemented');
    }

    async editMessage(_messageId: string, _newContent: MessageContent): Promise<void> {
        throw new Error('Not yet implemented');
    }

    async deleteMessage(_messageId: string): Promise<void> {
        throw new Error('Not yet implemented');
    }

    async exportHistory(): Promise<string> {
        throw new Error('Not yet implemented');
    }

    async importHistory(_data: string): Promise<void> {
        throw new Error('Not yet implemented');
    }

    // Lifecycle - placeholder implementation
    async save(): Promise<void> {
        this.metadata.updatedAt = new Date();
    }

    async load(): Promise<void> {
        // To be implemented when storage is added
    }

    // Utils
    getStats(): ChatStats {
        return {
            messageCount: this.metadata.messageCount,
            configurationChanges: 0,
            memoryUsage: 0,
            createdAt: this.metadata.createdAt,
            lastActivity: this.metadata.lastAccessedAt,
            totalTokens: this.robota.limits.getCurrentTokensUsed(),
            averageResponseTime: undefined
        };
    }

    updateConfig(config: Partial<ChatConfig>): void {
        Object.assign(this.config, config);

        if (config.chatName) {
            this.metadata.chatName = config.chatName;
        }
        if (config.description !== undefined) {
            this.metadata.description = config.description;
        }

        this._updateLastAccessed();
    }

    private _updateLastAccessed(): void {
        this.metadata.lastAccessedAt = new Date();
        this.metadata.updatedAt = new Date();
    }

    // Getter for history property (compatibility)
    get history() {
        return {
            getMessageCount: () => this.robota.limits.getCurrentRequestCount(),
            clear: () => this.robota.conversation.clear(),
        } as any;
    }
} 