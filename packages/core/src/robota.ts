import type {
    RunOptions
} from './types';
import type { AIProvider, Message, ModelResponse, StreamingResponseChunk } from './interfaces/ai-provider';
import type { Logger } from './interfaces/logger';
import type { ConversationHistory } from './conversation-history';
import type { ToolProvider } from '@robota-sdk/tools';

import { SimpleConversationHistory } from './conversation-history';
import { AIProviderManager } from './managers/ai-provider-manager';
import { ToolProviderManager } from './managers/tool-provider-manager';
import { SystemMessageManager } from './managers/system-message-manager';
import { FunctionCallManager, type FunctionCallConfig, type FunctionCallMode } from './managers/function-call-manager';
import { ConversationService } from './services/conversation-service';

/**
 * Robota configuration interface
 */
export interface RobotaOptions {
    /** 
     * Tool providers (toolProviders) - Providers that supply tools like MCP, OpenAPI, ZodFunction, etc.
     * Created with functions like createMcpToolProvider, createOpenAPIToolProvider, createZodFunctionToolProvider, etc.
     */
    toolProviders?: ToolProvider[];

    /** 
     * AI providers - Register multiple AI providers
     */
    aiProviders?: Record<string, AIProvider>;

    /** 
     * Current AI provider name to use
     */
    currentProvider?: string;

    /** 
     * Current model name to use
     */
    currentModel?: string;

    /** Model temperature (optional) */
    temperature?: number;

    /** Maximum number of tokens (optional) */
    maxTokens?: number;

    /** System prompt */
    systemPrompt?: string;

    /** Array of system messages */
    systemMessages?: Message[];

    /** Conversation history interface */
    conversationHistory?: ConversationHistory;

    /** Function call configuration */
    functionCallConfig?: FunctionCallConfig;

    /** Tool call callback */
    onToolCall?: (toolName: string, params: any, result: any) => void;

    /** Custom logger (default: console) */
    logger?: Logger;

    /** Debug mode (default: false) */
    debug?: boolean;
}

/**
 * Main class for Robota (refactored version)
 * Provides an interface for initializing and running agents
 * 
 * @example
 * ```ts
 * const robota = new Robota({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   systemPrompt: 'You are a helpful AI assistant.'
 * });
 * 
 * const response = await robota.run('Hello!');
 * ```
 */
export class Robota {
    // Managers
    private aiProviderManager: AIProviderManager;
    private toolProviderManager: ToolProviderManager;
    private systemMessageManager: SystemMessageManager;
    private functionCallManager: FunctionCallManager;
    private conversationService: ConversationService;

    // Basic configuration
    private conversationHistory: ConversationHistory;
    private onToolCall?: (toolName: string, params: any, result: any) => void;
    private logger: Logger;
    private debug: boolean;

    /**
     * Create a Robota instance
     * 
     * @param options - Robota initialization options
     */
    constructor(options: RobotaOptions) {
        // Basic configuration
        this.conversationHistory = options.conversationHistory || new SimpleConversationHistory();
        this.onToolCall = options.onToolCall;
        this.logger = options.logger || console;
        this.debug = options.debug || false;

        // Initialize managers
        this.aiProviderManager = new AIProviderManager();
        this.toolProviderManager = new ToolProviderManager(
            this.logger,
            options.functionCallConfig?.allowedFunctions
        );
        this.systemMessageManager = new SystemMessageManager();
        this.functionCallManager = new FunctionCallManager(options.functionCallConfig);
        this.conversationService = new ConversationService(
            options.temperature,
            options.maxTokens,
            this.logger,
            this.debug
        );

        // Register AI providers
        if (options.aiProviders) {
            for (const [name, aiProvider] of Object.entries(options.aiProviders)) {
                this.aiProviderManager.addProvider(name, aiProvider);
            }
        }

        // Set current AI configuration
        if (options.currentProvider && options.currentModel) {
            this.aiProviderManager.setCurrentAI(options.currentProvider, options.currentModel);
        }

        // Register Tool Providers
        if (options.toolProviders) {
            this.toolProviderManager.addProviders(options.toolProviders);
        }

        // Configure system messages
        if (options.systemMessages) {
            this.systemMessageManager.setSystemMessages(options.systemMessages);
        } else if (options.systemPrompt) {
            this.systemMessageManager.setSystemPrompt(options.systemPrompt);
        }
    }

    // ============================================================
    // AI Provider Management (delegation)
    // ============================================================

    /**
     * Add an AI provider
     */
    addAIProvider(name: string, aiProvider: AIProvider): void {
        this.aiProviderManager.addProvider(name, aiProvider);
    }

    /**
     * Set the current AI provider and model
     */
    setCurrentAI(providerName: string, model: string): void {
        this.aiProviderManager.setCurrentAI(providerName, model);
    }

    /**
     * Get registered AI providers and their available models
     */
    getAvailableAIs(): Record<string, string[]> {
        return this.aiProviderManager.getAvailableAIs();
    }

    /**
     * Get the currently configured AI provider and model
     */
    getCurrentAI(): { provider?: string; model?: string } {
        return this.aiProviderManager.getCurrentAI();
    }

    // ============================================================
    // System Message Management (delegation)
    // ============================================================

    /**
     * Set a single system prompt
     */
    setSystemPrompt(prompt: string): void {
        this.systemMessageManager.setSystemPrompt(prompt);
    }

    /**
     * Set multiple system messages
     */
    setSystemMessages(messages: Message[]): void {
        this.systemMessageManager.setSystemMessages(messages);
    }

    /**
     * Add a system message
     */
    addSystemMessage(content: string): void {
        this.systemMessageManager.addSystemMessage(content);
    }

    // ============================================================
    // Function Call Management (delegation)
    // ============================================================

    /**
     * Set function call mode
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        this.functionCallManager.setFunctionCallMode(mode);
    }

    /**
     * Configure function call settings
     */
    configureFunctionCall(config: {
        mode?: FunctionCallMode;
        maxCalls?: number;
        timeout?: number;
        allowedFunctions?: string[];
    }): void {
        this.functionCallManager.configure(config);

        // Update allowed function list in Tool Provider Manager as well
        if (config.allowedFunctions) {
            this.toolProviderManager.setAllowedFunctions(config.allowedFunctions);
        }
    }

    // ============================================================
    // Execution Methods
    // ============================================================

    /**
     * Execute a text prompt
     */
    async run(prompt: string, options: RunOptions = {}): Promise<string> {
        this.conversationHistory.addUserMessage(prompt);

        const context = this.conversationService.prepareContext(
            this.conversationHistory,
            this.systemMessageManager.getSystemPrompt(),
            this.systemMessageManager.getSystemMessages(),
            options
        );

        const response = await this.generateResponse(context, options);

        // Add assistant response to conversation history
        this.conversationHistory.addAssistantMessage(response.content || '', response.functionCall);

        return response.content || '';
    }

    /**
     * Process chat message and generate response
     */
    async chat(message: string, options: RunOptions = {}): Promise<string> {
        this.conversationHistory.addUserMessage(message);

        const context = this.conversationService.prepareContext(
            this.conversationHistory,
            this.systemMessageManager.getSystemPrompt(),
            this.systemMessageManager.getSystemMessages(),
            options
        );

        const response = await this.generateResponse(context, options);

        this.conversationHistory.addAssistantMessage(response.content || '', response.functionCall);

        return response.content || '';
    }

    /**
     * Generate streaming response
     */
    async runStream(prompt: string, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        this.conversationHistory.addUserMessage(prompt);

        const context = this.conversationService.prepareContext(
            this.conversationHistory,
            this.systemMessageManager.getSystemPrompt(),
            this.systemMessageManager.getSystemMessages(),
            options
        );

        return this.generateStream(context, options);
    }

    /**
     * Add response message to conversation history
     */
    addResponseToConversationHistory(response: ModelResponse): void {
        this.conversationHistory.addAssistantMessage(response.content || '', response.functionCall);
    }

    /**
     * Clear conversation history
     */
    clearConversationHistory(): void {
        this.conversationHistory.clear();
    }

    // ============================================================
    // Internal Helper Methods
    // ============================================================

    /**
     * Generate response (internal use)
     */
    private async generateResponse(context: any, options: RunOptions = {}): Promise<ModelResponse> {
        if (!this.aiProviderManager.isConfigured()) {
            throw new Error('Current AI provider and model are not configured. Use setCurrentAI() method to configure.');
        }

        const currentAiProvider = this.aiProviderManager.getCurrentProvider()!;
        const currentModel = this.aiProviderManager.getCurrentModel()!;

        // Use default mode if function call mode is not in options
        const enhancedOptions = {
            ...options,
            functionCallMode: options.functionCallMode || this.functionCallManager.getDefaultMode()
        };

        return this.conversationService.generateResponse(
            currentAiProvider,
            currentModel,
            context,
            enhancedOptions,
            this.toolProviderManager.getAvailableTools(),
            async (toolName: string, params: any) => {
                const result = await this.toolProviderManager.callTool(toolName, params);

                // Execute callback
                if (this.onToolCall) {
                    this.onToolCall(toolName, params, result);
                }

                return result;
            }
        );
    }

    /**
     * Generate streaming response (internal use)
     */
    private async generateStream(context: any, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        if (!this.aiProviderManager.isConfigured()) {
            throw new Error('Current AI provider and model are not configured. Use setCurrentAI() method to configure.');
        }

        const currentAiProvider = this.aiProviderManager.getCurrentProvider()!;
        const currentModel = this.aiProviderManager.getCurrentModel()!;

        return this.conversationService.generateStream(
            currentAiProvider,
            currentModel,
            context,
            options,
            this.toolProviderManager.getAvailableTools()
        );
    }

    /**
     * Call a tool (public API)
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        return this.toolProviderManager.callTool(toolName, parameters);
    }

    /**
     * Get list of available tools
     */
    getAvailableTools(): any[] {
        return this.toolProviderManager.getAvailableTools();
    }

    /**
     * Release resources
     */
    async close(): Promise<void> {
        await this.aiProviderManager.close();
    }
} 