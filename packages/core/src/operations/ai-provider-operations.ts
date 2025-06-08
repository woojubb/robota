import type { AIProvider } from '../interfaces/ai-provider';
import type { AIProviderManager } from '../managers/ai-provider-manager';
import type { RobotaConfigManager } from '../managers/robota-config-manager';

/**
 * AI Provider related pure functions
 * Separated AI Provider related logic from Robota class into pure functions
 */

/**
 * Pure function to add AI Provider
 */
export function addAIProvider(
    name: string,
    aiProvider: AIProvider,
    aiProviderManager: AIProviderManager,
    configManager: RobotaConfigManager
): void {
    aiProviderManager.addProvider(name, aiProvider);
    configManager.addAIProvider(name, aiProvider);
}

/**
 * Pure function to set current AI Provider and model
 */
export function setCurrentAI(
    providerName: string,
    model: string,
    aiProviderManager: AIProviderManager,
    configManager: RobotaConfigManager
): void {
    aiProviderManager.setCurrentAI(providerName, model);
    configManager.updateAIConfig({
        currentProvider: providerName,
        currentModel: model
    });
}

/**
 * Pure function to get current AI Provider and model information
 */
export function getCurrentAI(
    aiProviderManager: AIProviderManager
): { provider?: string; model?: string } {
    return aiProviderManager.getCurrentAI();
}

/**
 * Pure function to apply AI Provider configuration
 */
export function applyAIProviderConfiguration(
    config: {
        aiProviders: Record<string, AIProvider>;
        currentProvider?: string;
        currentModel?: string;
    },
    aiProviderManager: AIProviderManager
): void {
    // Register AI providers
    for (const [name, aiProvider] of Object.entries(config.aiProviders)) {
        aiProviderManager.addProvider(name, aiProvider);
    }

    // Set current AI configuration
    if (config.currentProvider && config.currentModel) {
        aiProviderManager.setCurrentAI(config.currentProvider, config.currentModel);
    }
} 