import type {
    Robota,
    ConversationHistory,
    AgentConfig
} from '@robota-sdk/agents';

/**
 * Configuration value type for chat settings
 */
export type ChatConfigValue = string | number | boolean | string[] | number[] | boolean[] | Date | null | undefined;

/**
 * Configuration change tracking
 */
export interface ConfigurationChange {
    id: string;
    timestamp: Date;
    type: 'provider' | 'model' | 'system' | 'function' | 'other';
    description: string;
    oldValue?: ChatConfigValue;
    newValue: ChatConfigValue;
    userId?: string;
}

/**
 * Message content with structured typing
 */
export type MessageContent = string | {
    text?: string;
    image?: string;
    file?: string;
    [key: string]: ChatConfigValue;
};

/**
 * Chat configuration interface
 */
export interface ChatConfig {
    chatName?: string;
    description?: string;
    robotaConfig?: AgentConfig; // Using AgentConfig instead of any
    autoSave?: boolean;
    maxHistorySize?: number;
    agentTemplate?: string; // Agent template name to use for creating specialized agents
    taskDescription?: string; // Task description for dynamic agent creation
}

/**
 * Chat metadata interface
 */
export interface ChatMetadata {
    chatId: string;
    sessionId: string;
    chatName: string;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
    lastAccessedAt: Date;
    messageCount: number;
    isActive: boolean;
}

/**
 * Enhanced conversation history with configuration tracking
 */
export interface EnhancedConversationHistory extends ConversationHistory {
    configurations: ConfigurationChange[];
    addConfigurationChange(change: ConfigurationChange): void;
    getConfigurationHistory(): ConfigurationChange[];
    clearConfigurationHistory(): void;

    // Additional utility methods
    updateMessage(index: number, content: string): boolean;
    removeMessage(index: number): boolean;
    getConfigurationChangeCount(): number;

    // Export/Import functionality
    export(): string;
    import(data: string): void;

    // Memory management
    getMemoryUsage(): number;
}

/**
 * Template manager interface for agent templates
 */
export interface TemplateManager {
    getTemplate(name: string): AgentConfig | undefined;
    listTemplates(): string[];
    validateTemplate(config: AgentConfig): boolean;
}

/**
 * Chat instance interface with proper typing
 */
export interface ChatInstance {
    readonly metadata: ChatMetadata;
    readonly config: ChatConfig;
    readonly robota: Robota;
    readonly history: EnhancedConversationHistory;

    // Chat Operations
    sendMessage(content: MessageContent): Promise<string>;
    regenerateResponse(): Promise<string>;
    editMessage(messageId: string, newContent: MessageContent): Promise<void>;
    deleteMessage(messageId: string): Promise<void>;

    // Configuration
    updateRobotaConfig(config: AgentConfig): Promise<void>;
    getRobotaConfig(): AgentConfig;

    // Agent Template Support
    upgradeToTemplate?(templateName: string, taskDescription?: string): Promise<void>;
    getTemplateManager?(): TemplateManager;

    // State Management  
    activate(): void;
    deactivate(): void;

    // History Management
    clearHistory(): void;
    exportHistory(): Promise<string>;
    importHistory(data: string): Promise<void>;

    // Lifecycle
    save(): Promise<void>;
    load(): Promise<void>;

    // Utils
    getStats(): ChatStats;
    updateConfig(config: Partial<ChatConfig>): void;
}

/**
 * Chat statistics interface
 */
export interface ChatStats {
    messageCount: number;
    configurationChanges: number;
    memoryUsage: number; // MB
    createdAt: Date;
    lastActivity: Date;
    totalTokens?: number;
    averageResponseTime?: number; // ms
} 