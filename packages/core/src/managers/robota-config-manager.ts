import type { Logger } from '../interfaces/logger';
import type { ConversationHistory } from '../conversation-history';
import type { AIProvider, Message } from '../interfaces/ai-provider';
import type { ToolProvider } from '@robota-sdk/tools';
import type { FunctionCallConfig } from './function-call-manager';
import { SimpleConversationHistory } from '../conversation-history';

/**
 * Complete configuration interface for Robota instance
 */
export interface RobotaConfiguration {
    // AI Configuration
    aiProviders: Record<string, AIProvider>;
    currentProvider?: string;
    currentModel?: string;
    temperature?: number;
    maxTokens?: number;

    // Tool Configuration
    toolProviders: ToolProvider[];
    functionCallConfig?: FunctionCallConfig;
    onToolCall?: (toolName: string, params: any, result: any) => void;

    // System Configuration
    systemPrompt?: string;
    systemMessages?: Message[];
    conversationHistory: ConversationHistory;

    // Logging and Debug
    logger: Logger;
    debug: boolean;

    // Limits
    maxTokenLimit: number;
    maxRequestLimit: number;
}

/**
 * Input configuration for creating RobotaConfiguration
 */
export interface RobotaConfigInput {
    toolProviders?: ToolProvider[];
    aiProviders?: Record<string, AIProvider>;
    currentProvider?: string;
    currentModel?: string;
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
    systemMessages?: Message[];
    conversationHistory?: ConversationHistory;
    functionCallConfig?: FunctionCallConfig;
    onToolCall?: (toolName: string, params: any, result: any) => void;
    logger?: Logger;
    debug?: boolean;
    maxTokenLimit?: number;
    maxRequestLimit?: number;
}

/**
 * Manages Robota configuration with validation and defaults
 * Follows single responsibility principle by handling only configuration logic
 */
export class RobotaConfigManager {
    private config: RobotaConfiguration;

    constructor(input: RobotaConfigInput) {
        this.config = this.createConfiguration(input);
        this.validateConfiguration();
    }

    /**
     * Create configuration with defaults applied
     */
    private createConfiguration(input: RobotaConfigInput): RobotaConfiguration {
        return {
            aiProviders: input.aiProviders || {},
            currentProvider: input.currentProvider,
            currentModel: input.currentModel,
            temperature: input.temperature,
            maxTokens: input.maxTokens,
            toolProviders: input.toolProviders || [],
            functionCallConfig: input.functionCallConfig,
            onToolCall: input.onToolCall,
            systemPrompt: input.systemPrompt,
            systemMessages: input.systemMessages,
            conversationHistory: input.conversationHistory || new SimpleConversationHistory(),
            logger: input.logger || console,
            debug: input.debug || false,
            maxTokenLimit: input.maxTokenLimit ?? 4096,
            maxRequestLimit: input.maxRequestLimit ?? 25
        };
    }

    /**
     * Validate configuration consistency
     */
    private validateConfiguration(): void {
        // Validate AI provider configuration
        if (this.config.currentProvider && !this.config.aiProviders[this.config.currentProvider]) {
            throw new Error(`Current AI provider '${this.config.currentProvider}' is not registered`);
        }

        // Validate limits
        if (this.config.maxTokenLimit < 0) {
            throw new Error('Maximum token limit cannot be negative');
        }

        if (this.config.maxRequestLimit < 0) {
            throw new Error('Maximum request limit cannot be negative');
        }
    }

    /**
     * Get the complete configuration
     */
    getConfiguration(): RobotaConfiguration {
        return { ...this.config }; // Return a copy to prevent external modification
    }

    /**
     * Update AI provider configuration
     */
    updateAIConfig(updates: {
        currentProvider?: string;
        currentModel?: string;
        temperature?: number;
        maxTokens?: number;
    }): void {
        if (updates.currentProvider !== undefined) {
            if (updates.currentProvider && !this.config.aiProviders[updates.currentProvider]) {
                throw new Error(`AI provider '${updates.currentProvider}' is not registered`);
            }
            this.config.currentProvider = updates.currentProvider;
        }

        if (updates.currentModel !== undefined) {
            this.config.currentModel = updates.currentModel;
        }

        if (updates.temperature !== undefined) {
            this.config.temperature = updates.temperature;
        }

        if (updates.maxTokens !== undefined) {
            this.config.maxTokens = updates.maxTokens;
        }
    }

    /**
     * Update system configuration
     */
    updateSystemConfig(updates: {
        systemPrompt?: string;
        systemMessages?: Message[];
        debug?: boolean;
    }): void {
        if (updates.systemPrompt !== undefined) {
            this.config.systemPrompt = updates.systemPrompt;
        }

        if (updates.systemMessages !== undefined) {
            this.config.systemMessages = updates.systemMessages;
        }

        if (updates.debug !== undefined) {
            this.config.debug = updates.debug;
        }
    }

    /**
     * Update limit configuration
     */
    updateLimits(updates: {
        maxTokenLimit?: number;
        maxRequestLimit?: number;
    }): void {
        if (updates.maxTokenLimit !== undefined) {
            if (updates.maxTokenLimit < 0) {
                throw new Error('Maximum token limit cannot be negative');
            }
            this.config.maxTokenLimit = updates.maxTokenLimit;
        }

        if (updates.maxRequestLimit !== undefined) {
            if (updates.maxRequestLimit < 0) {
                throw new Error('Maximum request limit cannot be negative');
            }
            this.config.maxRequestLimit = updates.maxRequestLimit;
        }
    }

    /**
     * Add AI provider
     */
    addAIProvider(name: string, provider: AIProvider): void {
        this.config.aiProviders[name] = provider;
    }

    /**
     * Remove AI provider
     */
    removeAIProvider(name: string): void {
        if (this.config.currentProvider === name) {
            this.config.currentProvider = undefined;
            this.config.currentModel = undefined;
        }
        delete this.config.aiProviders[name];
    }

    /**
     * Add tool provider
     */
    addToolProvider(provider: ToolProvider): void {
        this.config.toolProviders.push(provider);
    }

    /**
     * Remove tool provider
     */
    removeToolProvider(provider: ToolProvider): void {
        const index = this.config.toolProviders.indexOf(provider);
        if (index !== -1) {
            this.config.toolProviders.splice(index, 1);
        }
    }

    /**
     * Set tool call callback
     */
    setToolCallCallback(callback: (toolName: string, params: any, result: any) => void): void {
        this.config.onToolCall = callback;
    }

    /**
     * Check if AI is properly configured
     */
    isAIConfigured(): boolean {
        return !!(this.config.currentProvider && this.config.currentModel &&
            this.config.aiProviders[this.config.currentProvider]);
    }
} 