import type { AIProviderManagerInterface } from '../interfaces/manager';
import type { AIProvider } from '../interfaces/provider';
import { BaseManager } from '../abstracts/base-manager';
import { ConfigurationError, ValidationError } from '../utils/errors';
import { Validator } from '../utils/validation';
import { logger } from '../utils/logger';

/**
 * AI Providers implementation
 * Manages registration, selection, and state of AI providers
 * Instance-based for isolated provider management
 */
export class AIProviders extends BaseManager implements AIProviderManagerInterface {
    private providers = new Map<string, AIProvider>();
    private currentProvider: string | undefined;
    private currentModel: string | undefined;

    constructor() {
        super();
    }

    /**
     * Initialize the manager
     */
    protected async doInitialize(): Promise<void> {
        logger.debug('AIProviders initialized');
    }

    /**
     * Cleanup manager resources
     */
    protected async doDispose(): Promise<void> {
        // Close all providers
        for (const [name, provider] of this.providers) {
            try {
                if (provider.close) {
                    await provider.close();
                }
                logger.debug(`Closed AI provider: ${name}`);
            } catch (error) {
                logger.warn(`Failed to close AI provider ${name}`, {
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        this.providers.clear();
        this.currentProvider = undefined;
        this.currentModel = undefined;

        logger.debug('AIProviders disposed');
    }

    /**
     * Register an AI provider
     */
    addProvider(name: string, provider: AIProvider): void {
        this.ensureInitialized();

        // Validate provider name
        const nameValidation = Validator.validateProviderName(name);
        if (!nameValidation.isValid) {
            throw new ValidationError(`Invalid provider name: ${nameValidation.errors.join(', ')}`);
        }

        // Validate provider
        if (!provider || typeof provider !== 'object' || provider === null || Array.isArray(provider)) {
            throw new ValidationError('Provider must be a valid object instance');
        }

        if (!provider.name || typeof provider.name !== 'string') {
            throw new ValidationError('Provider must have a valid name');
        }

        if (typeof provider.chat !== 'function') {
            throw new ValidationError('Provider must have a chat method');
        }

        // Check for duplicate registration
        if (this.providers.has(name)) {
            logger.warn(`Provider "${name}" is already registered, overriding`, {
                providerName: name,
                existingProvider: this.providers.get(name)?.name
            });
        }

        this.providers.set(name, provider);
        logger.debug(`AI provider "${name}" registered successfully`, {
            providerName: name,
            version: provider.version,
            supportsStreaming: typeof provider.chatStream === 'function'
        });

        if (this.getCurrentProvider()?.provider === name) {
            logger.debug(`Cleared current provider selection after removing "${name}"`);
        }

        logger.debug(`AI provider "${name}" removed successfully`);
    }

    /**
     * Remove an AI provider
     */
    removeProvider(name: string): void {
        this.ensureInitialized();

        if (!this.providers.has(name)) {
            logger.warn(`Attempted to remove non-existent provider "${name}"`);
            return;
        }

        // Close provider if it has close method
        const provider = this.providers.get(name);
        if (provider?.close) {
            provider.close().catch((error: Error) => {
                logger.warn(`Failed to close provider ${name}`, {
                    error: error.message
                });
            });
        }

        this.providers.delete(name);

        // Clear current selection if this was the current provider
        if (this.currentProvider === name) {
            this.currentProvider = undefined;
            this.currentModel = undefined;
            logger.debug(`Cleared current provider selection after removing "${name}"`);
        }

        logger.debug(`AI provider "${name}" removed successfully`);
    }

    /**
     * Get registered provider by name
     */
    getProvider(name: string): AIProvider | undefined {
        this.ensureInitialized();
        return this.providers.get(name);
    }

    /**
     * Get all registered providers
     */
    getProviders(): Record<string, AIProvider> {
        this.ensureInitialized();
        return Object.fromEntries(this.providers);
    }

    /**
     * Set current provider and model
     */
    setCurrentProvider(name: string, model: string): void {
        this.ensureInitialized();

        // Validate provider exists
        const provider = this.providers.get(name);
        if (!provider) {
            throw new ConfigurationError(`Provider "${name}" is not registered`);
        }

        // Note: Model validation is now handled at runtime in ChatOptions
        // No pre-validation needed since models are provider-specific

        this.currentProvider = name;
        this.currentModel = model;

        logger.debug(`Current AI provider set to "${name}" with model "${model}"`);
    }

    /**
     * Get current provider and model
     */
    getCurrentProvider(): { provider: string; model: string } | undefined {
        this.ensureInitialized();

        if (!this.currentProvider || !this.currentModel) {
            return undefined;
        }

        return {
            provider: this.currentProvider,
            model: this.currentModel
        };
    }

    /**
     * Check if provider is configured
     */
    isConfigured(): boolean {
        this.ensureInitialized();
        return !!(this.currentProvider && this.currentModel && this.providers.has(this.currentProvider));
    }

    /**
     * Get available models for a provider
     * Note: In the new architecture, models are handled by each provider internally
     */
    getAvailableModels(providerName: string): string[] {
        this.ensureInitialized();

        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new ConfigurationError(`Provider "${providerName}" is not registered`);
        }

        // Return empty array since models are now provider-specific and handled internally
        logger.warn(`getAvailableModels() is deprecated. Models are now handled by providers internally.`);
        return [];
    }

    /**
     * Get current provider instance
     */
    getCurrentProviderInstance(): AIProvider | undefined {
        if (!this.isConfigured() || !this.currentProvider) {
            return undefined;
        }

        return this.providers.get(this.currentProvider);
    }

    /**
     * Get provider names
     */
    getProviderNames(): string[] {
        this.ensureInitialized();
        return Array.from(this.providers.keys());
    }

    /**
     * Get providers by pattern
     */
    getProvidersByPattern(pattern: string | RegExp): Record<string, AIProvider> {
        this.ensureInitialized();

        const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
        const result: Record<string, AIProvider> = {};

        for (const [name, provider] of this.providers) {
            if (regex.test(name)) {
                result[name] = provider;
            }
        }

        return result;
    }

    /**
     * Check if provider supports streaming
     */
    supportsStreaming(providerName?: string): boolean {
        this.ensureInitialized();

        const name = providerName || this.currentProvider;
        if (!name) {
            return false;
        }

        const provider = this.providers.get(name);
        return !!(provider && typeof provider.chatStream === 'function');
    }

    /**
     * Get provider count
     */
    getProviderCount(): number {
        this.ensureInitialized();
        return this.providers.size;
    }
} 