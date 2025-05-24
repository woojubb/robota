import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Google AI Provider 옵션
 */
export interface GoogleProviderOptions {
    /** Google AI client 인스턴스 */
    client: GoogleGenerativeAI;

    /** 사용할 기본 모델 */
    model?: string;

    /** 온도 설정 (0.0 ~ 1.0) */
    temperature?: number;

    /** 최대 토큰 수 */
    maxTokens?: number;

    /** 응답 형식 */
    responseFormat?: string;
} 