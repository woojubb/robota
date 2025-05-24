import type { AIProvider } from '../interfaces/ai-provider';

/**
 * AI 제공업체 관리 클래스
 * AI Provider들의 등록, 설정, 조회를 담당합니다.
 */
export class AIProviderManager {
    private aiProviders: Record<string, AIProvider> = {};
    private currentProvider?: string;
    private currentModel?: string;

    /**
     * AI 제공업체 추가
     * 
     * @param name - 제공업체 이름
     * @param aiProvider - AI 제공업체 인스턴스
     */
    addProvider(name: string, aiProvider: AIProvider): void {
        this.aiProviders[name] = aiProvider;
    }

    /**
     * 현재 AI 제공업체와 모델 설정
     * 
     * @param providerName - 제공업체 이름
     * @param model - 모델명
     */
    setCurrentAI(providerName: string, model: string): void {
        if (!this.aiProviders[providerName]) {
            throw new Error(`AI 제공업체 '${providerName}'를 찾을 수 없습니다.`);
        }

        const aiProvider = this.aiProviders[providerName];
        if (!aiProvider.availableModels.includes(model)) {
            throw new Error(`모델 '${model}'은 제공업체 '${providerName}'에서 지원되지 않습니다. 사용 가능한 모델: ${aiProvider.availableModels.join(', ')}`);
        }

        this.currentProvider = providerName;
        this.currentModel = model;
    }

    /**
     * 등록된 AI 제공업체들과 사용 가능한 모델들 반환
     */
    getAvailableAIs(): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const [name, aiProvider] of Object.entries(this.aiProviders)) {
            result[name] = aiProvider.availableModels;
        }
        return result;
    }

    /**
     * 현재 설정된 AI 제공업체와 모델 반환
     */
    getCurrentAI(): { provider?: string; model?: string } {
        return {
            provider: this.currentProvider,
            model: this.currentModel
        };
    }

    /**
     * 현재 AI 제공업체 인스턴스 반환
     */
    getCurrentProvider(): AIProvider | null {
        if (!this.currentProvider) {
            return null;
        }
        return this.aiProviders[this.currentProvider] || null;
    }

    /**
     * 현재 모델명 반환
     */
    getCurrentModel(): string | null {
        return this.currentModel || null;
    }

    /**
     * AI 제공업체가 설정되었는지 확인
     */
    isConfigured(): boolean {
        return !!(this.currentProvider && this.currentModel);
    }

    /**
     * 모든 AI 제공업체의 리소스 해제
     */
    async close(): Promise<void> {
        for (const [name, aiProvider] of Object.entries(this.aiProviders)) {
            if (aiProvider.close && typeof aiProvider.close === 'function') {
                await aiProvider.close();
            }
        }
    }
} 