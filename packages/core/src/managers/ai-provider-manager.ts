import type { AIProvider } from '../interfaces/ai-provider';

/**
 * AI provider management class
 * Responsible for registering, configuring, and querying AI providers.
 */
export class AIProviderManager {
    private aiProviders: Record<string, AIProvider> = {};
    private currentProvider?: string;
    private currentModel?: string;

    /**
     * Add an AI provider
     * 
     * @param name - Provider name
     * @param aiProvider - AI provider instance
     */
    addProvider(name: string, aiProvider: AIProvider): void {
        this.aiProviders[name] = aiProvider;
    }

    /**
     * Set current AI provider and model
     * 
     * @param providerName - Provider name
     * @param model - Model name
     */
    setCurrentAI(providerName: string, model: string): void {
        if (!this.aiProviders[providerName]) {
            throw new Error(`AI provider '${providerName}' not found.`);
        }

        const aiProvider = this.aiProviders[providerName];
        if (!aiProvider.availableModels.includes(model)) {
            throw new Error(`Model '${model}' is not supported by provider '${providerName}'. Available models: ${aiProvider.availableModels.join(', ')}`);
        }

        this.currentProvider = providerName;
        this.currentModel = model;
    }

    /**
     * Get registered AI providers and their available models
     */
    getAvailableAIs(): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const [name, aiProvider] of Object.entries(this.aiProviders)) {
            result[name] = aiProvider.availableModels;
        }
        return result;
    }

    /**
     * Get currently configured AI provider and model
     */
    getCurrentAI(): { provider?: string; model?: string } {
        return {
            provider: this.currentProvider,
            model: this.currentModel
        };
    }

    /**
     * Get current AI provider instance
     */
    getCurrentProvider(): AIProvider | null {
        if (!this.currentProvider) {
            return null;
        }
        return this.aiProviders[this.currentProvider] || null;
    }

    /**
     * Get current model name
     */
    getCurrentModel(): string | null {
        return this.currentModel || null;
    }

    /**
     * Check if AI provider is configured
     */
    isConfigured(): boolean {
        return !!(this.currentProvider && this.currentModel);
    }

    /**
     * Release resources of all AI providers
     */
    async close(): Promise<void> {
        for (const [name, aiProvider] of Object.entries(this.aiProviders)) {
            if (aiProvider.close && typeof aiProvider.close === 'function') {
                await aiProvider.close();
            }
        }
    }
} 