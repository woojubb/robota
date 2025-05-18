import type { ProviderOptions } from '@robota-sdk/core';

/**
 * Anthropic 제공업체 옵션
 */
export interface AnthropicProviderOptions extends ProviderOptions {
    apiKey: string;
}

/**
 * Anthropic 제공업체 클래스
 */
export class AnthropicProvider {
    constructor(options: AnthropicProviderOptions) {
        // 초기화 로직
    }

    // 구현 예정
}

export * from './types';
export * from './provider'; 