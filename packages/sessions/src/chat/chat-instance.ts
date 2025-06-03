import { Robota } from '@robota-sdk/core';
import type {
    ChatInstance,
    ChatConfig,
    ChatMetadata,
    ChatStats,
    MessageContent,
    EnhancedConversationHistory
} from '../types/chat';
import { EnhancedConversationHistoryImpl } from '../conversation-history/enhanced-conversation-history';
import { v4 as uuidv4 } from 'uuid';

export class ChatInstanceImpl implements ChatInstance {
    public readonly metadata: ChatMetadata;
    public readonly config: ChatConfig;
    public readonly robota: Robota;
    public readonly history: EnhancedConversationHistory;

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
            autoSave: config.autoSave ?? true,
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

        this.history = new EnhancedConversationHistoryImpl(
            this.config.maxHistorySize
        );

        this.robota = new Robota({
            ...this.config.robotaConfig,
            conversationHistory: this.history
        });
    }

    // Chat Operations
    async sendMessage(content: MessageContent): Promise<string> {
        this._updateLastAccessed();

        const messageText = typeof content === 'string' ? content : content.text || '';

        try {
            // Get response from Robota (this will automatically add to history)
            const response = await this.robota.run(messageText);

            this.metadata.messageCount = this.history.getMessageCount();

            if (this.config.autoSave) {
                await this.save();
            }

            return response;
        } catch (error) {
            throw new Error(`Failed to send message: ${error}`);
        }
    }

    async regenerateResponse(): Promise<string> {
        this._updateLastAccessed();

        const messages = this.history.getMessages();
        if (messages.length === 0) {
            throw new Error('No messages to regenerate response for');
        }

        // Find last user message
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        if (!lastUserMessage) {
            throw new Error('No user message found to regenerate response');
        }

        // Clear history and rebuild up to last user message
        const messagesUpToUser = messages.slice(0, messages.indexOf(lastUserMessage) + 1);
        this.history.clear();

        messagesUpToUser.forEach(msg => {
            this.history.addMessage(msg);
        });

        try {
            // Generate new response
            const response = await this.robota.run(lastUserMessage.content);

            this.metadata.messageCount = this.history.getMessageCount();

            if (this.config.autoSave) {
                await this.save();
            }

            return response;
        } catch (error) {
            throw new Error(`Failed to regenerate response: ${error}`);
        }
    }

    async editMessage(messageId: string, newContent: MessageContent): Promise<void> {
        this._updateLastAccessed();

        const messageText = typeof newContent === 'string' ? newContent : newContent.text || '';
        const messages = this.history.getMessages();
        const messageIndex = messages.findIndex(m => (m as any).id === messageId);

        if (messageIndex === -1) {
            throw new Error(`Message with id ${messageId} not found`);
        }

        if (this.history.updateMessage(messageIndex, messageText)) {
            if (this.config.autoSave) {
                await this.save();
            }
        }
    }

    async deleteMessage(messageId: string): Promise<void> {
        this._updateLastAccessed();

        const messages = this.history.getMessages();
        const messageIndex = messages.findIndex(m => (m as any).id === messageId);

        if (messageIndex === -1) {
            throw new Error(`Message with id ${messageId} not found`);
        }

        if (this.history.removeMessage(messageIndex)) {
            this.metadata.messageCount--;

            if (this.config.autoSave) {
                await this.save();
            }
        }
    }

    // Configuration
    async updateRobotaConfig(config: any): Promise<void> {
        this._updateLastAccessed();

        const oldConfig = this.config.robotaConfig;

        // Update local config
        this.config.robotaConfig = { ...this.config.robotaConfig, ...config };

        // Track configuration change
        this.history.addConfigurationChange({
            id: uuidv4(),
            timestamp: new Date(),
            type: 'other',
            description: 'Robota configuration updated',
            oldValue: oldConfig,
            newValue: config
        });

        // Note: Robota doesn't have updateConfiguration method,
        // so we would need to recreate the instance or find another way

        if (this.config.autoSave) {
            await this.save();
        }
    }

    getRobotaConfig(): any {
        return this.config.robotaConfig;
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
        this.robota.clearConversationHistory();
        this.metadata.messageCount = 0;
        this._updateLastAccessed();
    }

    async exportHistory(): Promise<string> {
        return this.history.export();
    }

    async importHistory(data: string): Promise<void> {
        this.history.import(data);
        this.metadata.messageCount = this.history.getMessageCount();
        this._updateLastAccessed();
    }

    // Lifecycle
    async save(): Promise<void> {
        // This will be implemented when storage is integrated
        this.metadata.updatedAt = new Date();
    }

    async load(): Promise<void> {
        // This will be implemented when storage is integrated
    }

    // Utils
    getStats(): ChatStats {
        return {
            messageCount: this.metadata.messageCount,
            configurationChanges: this.history.getConfigurationChangeCount(),
            memoryUsage: this.history.getMemoryUsage(),
            createdAt: this.metadata.createdAt,
            lastActivity: this.metadata.lastAccessedAt,
            totalTokens: this.robota.getTotalTokensUsed(),
            averageResponseTime: undefined // Can be implemented later
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
} 