import type {
    Robota,
    ConversationHistory,
    UniversalMessage
} from '@robota-sdk/core';

export interface ConfigurationChange {
    id: string;
    timestamp: Date;
    type: 'provider' | 'model' | 'system' | 'function' | 'other';
    description: string;
    oldValue?: any;
    newValue: any;
    userId?: string;
}

export type MessageContent = string | {
    text?: string;
    image?: string;
    file?: string;
    [key: string]: any;
};

export interface ChatConfig {
    chatName?: string;
    description?: string;
    robotaConfig?: any; // Initial Robota configuration
    autoSave?: boolean;
    maxHistorySize?: number;
}

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
    updateRobotaConfig(config: any): Promise<void>;
    getRobotaConfig(): any;

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

export interface ChatStats {
    messageCount: number;
    configurationChanges: number;
    memoryUsage: number; // MB
    createdAt: Date;
    lastActivity: Date;
    totalTokens?: number;
    averageResponseTime?: number; // ms
} 