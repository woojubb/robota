import { ProviderOptions } from '@robota-sdk/core';

/**
 * MCP 클라이언트 인터페이스
 * @modelcontextprotocol/sdk의 Client와 호환됩니다
 */
export interface MCPClient {
    // MCP 클라이언트의 필수 메서드들
    chat: (options: any) => Promise<any>;
    stream: (options: any) => AsyncIterable<any>;
    // 추가 메서드들...
}

/**
 * MCP 공통 제공업체 옵션
 */
export interface MCPCommonOptions {
    /**
     * 모델 이름
     */
    model: string;

    /**
     * 모델 생성 온도
     */
    temperature?: number;

    /**
     * 최대 토큰 수
     */
    maxTokens?: number;

    /**
     * 정지 시퀀스
     */
    stopSequences?: string[];

    /**
     * 스트리밍 모드 활성화 여부
     */
    streamMode?: boolean;
}

/**
 * MCP 제공업체 옵션 - Client 방식
 */
export interface MCPClientProviderOptions extends MCPCommonOptions {
    /**
     * MCP 클라이언트 인스턴스 (필수)
     */
    client: MCPClient;

    /**
     * 클라이언트 타입을 'client'로 지정
     */
    type: 'client';
}

/**
 * OpenAPI 스키마 기반 MCP 제공업체 옵션
 */
export interface MCPOpenAPIProviderOptions extends MCPCommonOptions {
    /**
     * OpenAPI 스키마 문서 (필수)
     * JSON 객체 또는 스키마의 URL
     */
    schema: object | string;

    /**
     * 엔드포인트 기본 URL
     */
    baseURL?: string;

    /**
     * API 요청 헤더
     */
    headers?: Record<string, string>;

    /**
     * 클라이언트 타입을 'openapi'로 지정
     */
    type: 'openapi';
}

/**
 * MCP 제공업체 옵션 통합 타입
 */
export type MCPProviderOptions = MCPClientProviderOptions | MCPOpenAPIProviderOptions; 