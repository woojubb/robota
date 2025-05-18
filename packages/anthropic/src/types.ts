import { ProviderOptions } from '@robota-sdk/core';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Anthropic 제공업체 옵션
 */
export interface AnthropicProviderOptions extends ProviderOptions {
    /**
     * Anthropic API 키 (옵션: client를 사용하는 경우 필요하지 않음)
     */
    apiKey?: string;

    /**
     * API 요청 타임아웃 (밀리초)
     */
    timeout?: number;

    /**
     * API 기본 URL
     */
    baseURL?: string;

    /**
     * Anthropic 클라이언트 인스턴스 (필수)
     */
    client: Anthropic;
} 