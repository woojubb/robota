import { Robota, type AgentConfig } from '@robota-sdk/agents';
import type {
    ChatConfig,
    ChatMetadata,
    ChatStats,
    MessageContent,
    TemplateManager,
    EnhancedConversationHistory,
    ChatInstance as IChatInstance
} from '../types/chat';

/**
 * Implementation of ChatInstance interface with proper type safety
 */
export class ChatInstance implements IChatInstance {
    public readonly metadata: ChatMetadata;
    public readonly config: ChatConfig;
    public readonly robota: Robota;
    public readonly history: EnhancedConversationHistory;

    constructor(
        metadata: ChatMetadata,
        config: ChatConfig,
        robota: Robota,
        history: EnhancedConversationHistory
    ) {
        this.metadata = metadata;
        this.config = config;
        this.robota = robota;
        this.history = history;
    }

    /**
     * Send a message and get AI response
     */
    async sendMessage(content: MessageContent): Promise<string> {
        const input = typeof content === 'string'
            ? content
            : content.text || JSON.stringify(content);

        try {
            const response = await this.robota.run(input);
            this.metadata.messageCount++;
            this.metadata.lastAccessedAt = new Date();
            return response;
        } catch (error) {
            throw new Error(`Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Regenerate the last response
     */
    async regenerateResponse(): Promise<string> {
        // Note: This would need implementation based on actual history manager API
        throw new Error('Regenerate response not yet implemented - needs history manager API');
    }

    /**
     * Edit a message in history
     */
    async editMessage(_messageId: string, _newContent: MessageContent): Promise<void> {
        // Implementation would depend on history manager API
        throw new Error('Message editing not yet implemented in history manager');
    }

    /**
     * Delete a message from history
     */
    async deleteMessage(_messageId: string): Promise<void> {
        // Implementation would depend on history manager API
        throw new Error('Message deletion not yet implemented in history manager');
    }

    /**
     * Update robota configuration
     */
    async updateRobotaConfig(config: AgentConfig): Promise<void> {
        try {
            await this.robota.configure(config);
            this.config.robotaConfig = { ...this.config.robotaConfig, ...config };
            this.metadata.updatedAt = new Date();
        } catch (error) {
            throw new Error(`Failed to update robota config: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get current robota configuration
     */
    getRobotaConfig(): AgentConfig {
        return this.config.robotaConfig || {
            name: 'default',
            model: 'gpt-3.5-turbo',
            provider: 'openai'
        };
    }

    /**
     * Upgrade to use an agent template
     */
    async upgradeToTemplate(templateName: string, taskDescription?: string): Promise<void> {
        const templateManager = this.getTemplateManager();
        if (!templateManager) {
            throw new Error('Template manager not available');
        }

        const template = templateManager.getTemplate(templateName);
        if (!template) {
            throw new Error(`Template '${templateName}' not found`);
        }

        await this.updateRobotaConfig(template);
        this.config.agentTemplate = templateName;
        if (taskDescription) {
            this.config.taskDescription = taskDescription;
        }
    }

    /**
     * Get template manager instance
     */
    getTemplateManager(): TemplateManager {
        // Return a default implementation that throws errors
        return {
            getTemplate: () => {
                throw new Error('Template manager not implemented');
            },
            listTemplates: () => {
                throw new Error('Template manager not implemented');
            },
            validateTemplate: () => {
                throw new Error('Template manager not implemented');
            }
        };
    }

    /**
     * Activate this chat session
     */
    activate(): void {
        this.metadata.isActive = true;
        this.metadata.lastAccessedAt = new Date();
    }

    /**
     * Deactivate this chat session
     */
    deactivate(): void {
        this.metadata.isActive = false;
    }

    /**
     * Clear conversation history
     */
    clearHistory(): void {
        // Note: Need to implement clear method in EnhancedConversationHistory
        // For now, use available method or throw error
        throw new Error('Clear history not yet implemented in EnhancedConversationHistory');
    }

    /**
     * Export conversation history
     */
    async exportHistory(): Promise<string> {
        return this.history.export();
    }

    /**
     * Import conversation history
     */
    async importHistory(data: string): Promise<void> {
        this.history.import(data);
        // Note: Would need to count messages from imported data
        this.metadata.updatedAt = new Date();
    }

    /**
     * Save chat state
     */
    async save(): Promise<void> {
        // Implementation would persist to storage
        throw new Error('Chat persistence not yet implemented');
    }

    /**
     * Load chat state
     */
    async load(): Promise<void> {
        // Implementation would load from storage
        throw new Error('Chat loading not yet implemented');
    }

    /**
     * Get chat statistics
     */
    getStats(): ChatStats {
        return {
            messageCount: this.metadata.messageCount,
            configurationChanges: this.history.getConfigurationChangeCount(),
            memoryUsage: this.history.getMemoryUsage(),
            createdAt: this.metadata.createdAt,
            lastActivity: this.metadata.lastAccessedAt
        };
    }

    /**
     * Update chat configuration
     */
    updateConfig(config: Partial<ChatConfig>): void {
        Object.assign(this.config, config);
        this.metadata.updatedAt = new Date();
    }
} 