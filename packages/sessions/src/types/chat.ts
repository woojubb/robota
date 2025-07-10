import type {
    Robota,
    AgentConfig,
    Message
} from '@robota-sdk/agents';

/**
 * Simple message content type
 */
export type MessageContent = string;

/**
 * Chat configuration interface - simplified
 */
export interface ChatConfig {
    chatName?: string;
    description?: string;
    robotaConfig: AgentConfig; // Required for creating the agent
    agentTemplate?: string; // Agent template name for specialized agents
}

/**
 * Chat metadata interface - simplified
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
 * Template manager interface for agent templates
 */
export interface TemplateManager {
    getTemplate(name: string): AgentConfig | undefined;
    listTemplates(): string[];
    validateTemplate(config: AgentConfig): boolean;
}

/**
 * Simplified chat instance interface - just a wrapper around Robota
 */
export interface ChatInstance {
    readonly metadata: ChatMetadata;
    readonly config: ChatConfig;
    readonly robota: Robota;

    // Core Chat Operations
    sendMessage(content: MessageContent): Promise<string>;
    regenerateResponse(): Promise<string>;

    // Configuration
    updateRobotaConfig(config: AgentConfig): Promise<void>;
    getRobotaConfig(): AgentConfig;

    // Agent Template Support
    upgradeToTemplate?(templateName: string): Promise<void>;
    getTemplateManager?(): TemplateManager;

    // State Management  
    activate(): void;
    deactivate(): void;

    // History Management - delegate to Robota
    getHistory(): Message[];
    clearHistory(): void;

    // Lifecycle
    save(): Promise<void>;
    load(): Promise<void>;

    // Utils
    getStats(): ChatStats;
    updateConfig(config: Partial<ChatConfig>): void;
}

/**
 * Chat statistics interface - simplified
 */
export interface ChatStats {
    messageCount: number;
    createdAt: Date;
    lastActivity: Date;
    totalTokens?: number;
    averageResponseTime?: number; // ms
} 