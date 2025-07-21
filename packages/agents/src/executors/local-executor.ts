import type {
    ChatExecutionRequest,
    StreamExecutionRequest,
    LocalExecutorConfig
} from '../interfaces/executor';
import type { UniversalMessage, AssistantMessage } from '../managers/conversation-history-manager';
import { BaseExecutor } from '../abstracts/base-executor';

/**
 * Local executor that directly delegates to AI provider instances
 * 
 * This executor maintains a registry of AI provider instances and delegates
 * chat execution requests to the appropriate provider based on the provider
 * name in the request. This is the "traditional" execution mode where
 * API calls are made directly from the client.
 * 
 * @example
 * ```typescript
 * import { LocalExecutor } from '@robota-sdk/agents';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const executor = new LocalExecutor();
 * executor.registerProvider('openai', new OpenAIProvider({ apiKey: 'sk-...' }));
 * 
 * const response = await executor.executeChat({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   provider: 'openai',
 *   model: 'gpt-4'
 * });
 * ```
 */
export class LocalExecutor extends BaseExecutor {
    readonly name = 'local';
    readonly version = '1.0.0';

    private providers = new Map<string, AIProviderInstance>();
    private config: Required<LocalExecutorConfig>;

    constructor(config: LocalExecutorConfig = {}) {
        super();
        this.config = {
            timeout: 30000,
            maxRetries: 3,
            retryDelay: 1000,
            enableLogging: false,
            ...config
        };
    }

    /**
     * Register an AI provider instance for use with this executor
     * 
     * @param name - Provider name (e.g., 'openai', 'anthropic', 'google')
     * @param provider - Provider instance that implements the required chat methods
     */
    registerProvider(name: string, provider: AIProviderInstance): void {
        this.providers.set(name, provider);
    }

    /**
     * Unregister an AI provider
     * 
     * @param name - Provider name to remove
     */
    unregisterProvider(name: string): void {
        this.providers.delete(name);
    }

    /**
     * Get registered provider instance
     * 
     * @param name - Provider name
     * @returns Provider instance or undefined if not registered
     */
    getProvider(name: string): AIProviderInstance | undefined {
        return this.providers.get(name);
    }

    /**
     * Execute a chat completion request by delegating to the appropriate provider
     */
    async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
        this.validateRequest(request);

        const provider = this.providers.get(request.provider);
        if (!provider) {
            throw new Error(`Provider "${request.provider}" not registered with LocalExecutor`);
        }

        if (!provider.chat) {
            throw new Error(`Provider "${request.provider}" does not implement chat method`);
        }

        if (this.config.enableLogging) {
            this.logDebug(`Executing chat with provider: ${request.provider}, model: ${request.model}`);
        }

        try {
            // Delegate to provider's chat method with retry logic
            const response = await this.withRetry(async () => {
                return await this.withTimeout(
                    provider.chat!(request.messages, {
                        ...request.options,
                        model: request.model,
                        tools: request.tools
                    }),
                    this.config.timeout
                );
            }, this.config.maxRetries, this.config.retryDelay);

            // Ensure response is properly typed as AssistantMessage
            if (response.role !== 'assistant') {
                throw new Error(`Expected assistant message, got ${response.role}`);
            }

            this.validateResponse(response);
            return response as AssistantMessage;

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logError('Chat execution failed', err, {
                provider: request.provider,
                model: request.model
            });
            throw err;
        }
    }

    /**
     * Execute a streaming chat completion request
     */
    async *executeChatStream(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        this.validateRequest(request);

        const provider = this.providers.get(request.provider);
        if (!provider) {
            throw new Error(`Provider "${request.provider}" not registered with LocalExecutor`);
        }

        if (!provider.chatStream) {
            throw new Error(`Provider "${request.provider}" does not implement chatStream method`);
        }

        if (this.config.enableLogging) {
            this.logDebug(`Executing streaming chat with provider: ${request.provider}, model: ${request.model}`);
        }

        try {
            // Delegate to provider's chatStream method
            const stream = provider.chatStream(request.messages, {
                ...request.options,
                model: request.model,
                tools: request.tools
            });

            for await (const chunk of stream) {
                this.validateResponse(chunk);
                yield chunk;
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logError('Streaming chat execution failed', err, {
                provider: request.provider,
                model: request.model
            });
            throw err;
        }
    }

    /**
     * Check if any registered providers support tools
     */
    override supportsTools(): boolean {
        for (const provider of this.providers.values()) {
            if (provider.supportsTools && provider.supportsTools()) {
                return true;
            }
        }
        return false;
    }

    /**
     * Validate executor configuration and all registered providers
     */
    override validateConfig(): boolean {
        try {
            // Validate executor config
            if (this.config.timeout <= 0) {
                return false;
            }
            if (this.config.maxRetries < 0) {
                return false;
            }
            if (this.config.retryDelay < 0) {
                return false;
            }

            // Validate all registered providers
            for (const provider of this.providers.values()) {
                if (provider.validateConfig && !provider.validateConfig()) {
                    return false;
                }
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Clean up all registered providers
     */
    override async dispose(): Promise<void> {
        if (this.config.enableLogging) {
            this.logDebug(`Disposing ${this.providers.size} providers`);
        }

        const disposePromises: Promise<void>[] = [];

        for (const provider of this.providers.values()) {
            if (provider.dispose) {
                disposePromises.push(provider.dispose());
            }
        }

        await Promise.all(disposePromises);
        this.providers.clear();
    }
}

/**
 * Interface that AI provider instances must implement to work with LocalExecutor
 * 
 * This interface represents the subset of AI provider methods that LocalExecutor
 * needs to delegate to. It's designed to be compatible with existing BaseAIProvider
 * implementations from @robota-sdk packages.
 */
export interface AIProviderInstance {
    /** Provider name */
    readonly name?: string;

    /** Chat completion method */
    chat?(messages: UniversalMessage[], options?: any): Promise<UniversalMessage>;

    /** Streaming chat completion method */
    chatStream?(messages: UniversalMessage[], options?: any): AsyncIterable<UniversalMessage>;

    /** Check if provider supports tools */
    supportsTools?(): boolean;

    /** Validate provider configuration */
    validateConfig?(): boolean;

    /** Clean up provider resources */
    dispose?(): Promise<void>;
} 