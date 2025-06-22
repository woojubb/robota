import { Robota, AgentFactory } from '@robota-sdk/agents';
import type { RobotaConfig, AgentCreationConfig } from '@robota-sdk/agents';
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
    private _agentFactory?: AgentFactory;

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
            maxHistorySize: config.maxHistorySize || 1000,
            agentTemplate: config.agentTemplate,
            taskDescription: config.taskDescription
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

        // Create Robota instance using AgentFactory if template or task description is provided
        this.robota = this._createRobotaInstance();
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

    // 간소화된 메서드들
    async updateRobotaConfig(config: any): Promise<void> {
        this._updateLastAccessed();
        this.config.robotaConfig = { ...this.config.robotaConfig, ...config };
    }

    getRobotaConfig(): any {
        return this.config.robotaConfig;
    }

    // 사용하지 않는 복잡한 기능들 제거
    async regenerateResponse(): Promise<string> {
        throw new Error('아직 구현되지 않음');
    }

    async editMessage(messageId: string, newContent: MessageContent): Promise<void> {
        throw new Error('아직 구현되지 않음');
    }

    async deleteMessage(messageId: string): Promise<void> {
        throw new Error('아직 구현되지 않음');
    }

    async exportHistory(): Promise<string> {
        throw new Error('아직 구현되지 않음');
    }

    async importHistory(data: string): Promise<void> {
        throw new Error('아직 구현되지 않음');
    }

    // Lifecycle - 일단 비워둠
    async save(): Promise<void> {
        this.metadata.updatedAt = new Date();
    }

    async load(): Promise<void> {
        // 스토리지 구현 시 추가
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

    /**
     * Create Robota instance using AgentFactory if template support is needed
     */
    private _createRobotaInstance(): Robota {
        const baseConfig = this.config.robotaConfig as RobotaOptions;

        // If template or task description is provided, use AgentFactory
        if (this.config.agentTemplate || this.config.taskDescription) {
            this._agentFactory = new AgentFactory(baseConfig);

            const agentConfig: AgentCreationConfig = {
                templateName: this.config.agentTemplate,
                taskDescription: this.config.taskDescription || `Chat instance: ${this.config.chatName}`,
                requiredTools: [], // Could be extended to support tool configuration
                agentConfig: {} // Could be extended for agent-specific overrides
            };

            // Since AgentFactory.createAgent returns a Promise, we need to handle this differently
            // For now, create a regular Robota instance and provide a method to upgrade to template-based
            return new Robota(baseConfig);
        }

        // Default: create regular Robota instance
        return new Robota(baseConfig);
    }

    /**
     * Upgrade chat to use a specific agent template
     */
    async upgradeToTemplate(templateName: string, taskDescription?: string): Promise<void> {
        if (!this._agentFactory) {
            this._agentFactory = new AgentFactory(this.config.robotaConfig as RobotaOptions);
        }

        const agentConfig: AgentCreationConfig = {
            templateName,
            taskDescription: taskDescription || this.config.taskDescription || `Chat instance: ${this.config.chatName}`,
            requiredTools: [],
            agentConfig: {}
        };

        try {
            const newRobota = await this._agentFactory.createAgent(agentConfig);

            // Transfer conversation history to new instance
            const messages = this.robota.conversation.getMessages();
            messages.forEach(message => {
                newRobota.conversation.addMessage(message);
            });

            // Replace the robota instance
            Object.assign(this, { robota: newRobota });

            // Update config
            this.config.agentTemplate = templateName;
            if (taskDescription) {
                this.config.taskDescription = taskDescription;
            }

            this._updateLastAccessed();
        } catch (error) {
            throw new Error(`Failed to upgrade to template: ${error}`);
        }
    }

    /**
     * Get the template manager for advanced template operations
     */
    getTemplateManager() {
        if (!this._agentFactory) {
            this._agentFactory = new AgentFactory(this.config.robotaConfig as RobotaOptions);
        }
        return this._agentFactory.getTemplateManager();
    }

    // history 프로퍼티를 위한 getter (호환성)
    get history() {
        return {
            getMessageCount: () => this.robota.limits.getCurrentRequestCount(),
            clear: () => this.robota.conversation.clear(),
        } as any;
    }
} 