import type { AIProvider } from '../interfaces/ai-provider';
import type { AIProviderManager } from '../managers/ai-provider-manager';
import type { RobotaConfigManager } from '../managers/robota-config-manager';

/**
 * AI Provider 관련 순수 함수들
 * Robota 클래스의 AI Provider 관련 로직을 순수 함수로 분리
 */

/**
 * AI Provider를 추가하는 순수 함수
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
 * 현재 AI Provider와 모델을 설정하는 순수 함수
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
 * 현재 AI Provider와 모델 정보를 가져오는 순수 함수
 */
export function getCurrentAI(
    aiProviderManager: AIProviderManager
): { provider?: string; model?: string } {
    return aiProviderManager.getCurrentAI();
}

/**
 * AI Provider 설정을 적용하는 순수 함수
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