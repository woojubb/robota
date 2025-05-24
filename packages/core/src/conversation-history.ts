import type { FunctionCall, FunctionCallResult } from '@robota-sdk/tools';

/**
 * Universal message role type - AI Provider에 종속되지 않는 중립적인 역할
 */
export type UniversalMessageRole = 'user' | 'assistant' | 'system' | 'tool';

/**
 * Universal message interface - AI Provider에 독립적인 메시지 구조
 */
export interface UniversalMessage {
    /** 메시지 역할 */
    role: UniversalMessageRole;

    /** 메시지 내용 */
    content: string;

    /** 메시지 발신자 이름 (optional) */
    name?: string;

    /** 함수 호출 정보 (assistant 메시지에서 사용) */
    functionCall?: FunctionCall;

    /** 도구 실행 결과 (tool 메시지에서 사용) */
    toolResult?: FunctionCallResult;

    /** 메시지 생성 시각 */
    timestamp: Date;

    /** 추가 메타데이터 */
    metadata?: Record<string, any>;
}

/**
 * Conversation history interface
 * 
 * 대화 기록을 관리하는 인터페이스로, AI Provider에 종속되지 않는 중립적인 형태로 설계됨
 */
export interface ConversationHistory {
    /**
     * 메시지를 대화 기록에 추가
     */
    addMessage(message: UniversalMessage): void;

    /**
     * 사용자 메시지 추가 (편의 메서드)
     */
    addUserMessage(content: string, metadata?: Record<string, any>): void;

    /**
     * 어시스턴트 메시지 추가 (편의 메서드)
     */
    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void;

    /**
     * 시스템 메시지 추가 (편의 메서드)
     */
    addSystemMessage(content: string, metadata?: Record<string, any>): void;

    /**
     * 도구 실행 결과 메시지 추가 (편의 메서드)
     */
    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void;

    /**
     * 모든 메시지 가져오기
     */
    getMessages(): UniversalMessage[];

    /**
     * 특정 역할의 메시지만 가져오기
     */
    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[];

    /**
     * 최근 n개의 메시지 가져오기
     */
    getRecentMessages(count: number): UniversalMessage[];

    /**
     * 대화 기록 정리
     */
    clear(): void;

    /**
     * 메시지 개수 반환
     */
    getMessageCount(): number;
}

/**
 * 기본 대화 기록 구현체
 */
export class SimpleConversationHistory implements ConversationHistory {
    private messages: UniversalMessage[] = [];
    private maxMessages: number;

    constructor(options?: { maxMessages?: number }) {
        this.maxMessages = options?.maxMessages || 0;
    }

    addMessage(message: UniversalMessage): void {
        this.messages.push(message);
        this._applyMessageLimit();
    }

    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'user',
            content,
            timestamp: new Date(),
            metadata
        });
    }

    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'assistant',
            content,
            functionCall,
            timestamp: new Date(),
            metadata
        });
    }

    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.addMessage({
            role: 'system',
            content,
            timestamp: new Date(),
            metadata
        });
    }

    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        const content = toolResult.error
            ? `Tool execution error: ${toolResult.error}`
            : `Tool result: ${JSON.stringify(toolResult.result)}`;

        this.addMessage({
            role: 'tool',
            content,
            name: toolResult.name,
            toolResult,
            timestamp: new Date(),
            metadata
        });
    }

    getMessages(): UniversalMessage[] {
        return [...this.messages];
    }

    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.messages.filter(msg => msg.role === role);
    }

    getRecentMessages(count: number): UniversalMessage[] {
        return this.messages.slice(-count);
    }

    getMessageCount(): number {
        return this.messages.length;
    }

    clear(): void {
        this.messages = [];
    }

    private _applyMessageLimit(): void {
        if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
            // 시스템 메시지는 항상 유지
            const systemMessages = this.messages.filter(m => m.role === 'system');
            const nonSystemMessages = this.messages.filter(m => m.role !== 'system');

            // 시스템 메시지를 제외한 메시지만 제한 적용
            const remainingCount = this.maxMessages - systemMessages.length;
            const trimmedNonSystemMessages = nonSystemMessages.slice(-remainingCount);

            // 시스템 메시지와 제한된 일반 메시지 결합
            this.messages = [...systemMessages, ...trimmedNonSystemMessages];
        }
    }
}

/**
 * 시스템 메시지를 유지하는 대화 기록 구현체
 */
export class PersistentSystemConversationHistory implements ConversationHistory {
    private history: SimpleConversationHistory;
    private systemPrompt: string;

    constructor(systemPrompt: string, options?: { maxMessages?: number }) {
        this.history = new SimpleConversationHistory(options);
        this.systemPrompt = systemPrompt;

        // 초기 시스템 메시지 추가
        this.history.addSystemMessage(this.systemPrompt);
    }

    addMessage(message: UniversalMessage): void {
        this.history.addMessage(message);
    }

    addUserMessage(content: string, metadata?: Record<string, any>): void {
        this.history.addUserMessage(content, metadata);
    }

    addAssistantMessage(content: string, functionCall?: FunctionCall, metadata?: Record<string, any>): void {
        this.history.addAssistantMessage(content, functionCall, metadata);
    }

    addSystemMessage(content: string, metadata?: Record<string, any>): void {
        this.history.addSystemMessage(content, metadata);
    }

    addToolMessage(toolResult: FunctionCallResult, metadata?: Record<string, any>): void {
        this.history.addToolMessage(toolResult, metadata);
    }

    getMessages(): UniversalMessage[] {
        return this.history.getMessages();
    }

    getMessagesByRole(role: UniversalMessageRole): UniversalMessage[] {
        return this.history.getMessagesByRole(role);
    }

    getRecentMessages(count: number): UniversalMessage[] {
        return this.history.getRecentMessages(count);
    }

    getMessageCount(): number {
        return this.history.getMessageCount();
    }

    clear(): void {
        this.history.clear();
        // 시스템 메시지 다시 추가
        this.history.addSystemMessage(this.systemPrompt);
    }

    /**
     * 시스템 프롬프트 업데이트
     */
    updateSystemPrompt(systemPrompt: string): void {
        this.systemPrompt = systemPrompt;

        // 기존 시스템 메시지가 아닌 메시지들만 보존
        const nonSystemMessages = this.history.getMessages().filter(m => m.role !== 'system');
        this.history.clear();

        // 새로운 시스템 메시지 추가
        this.history.addSystemMessage(this.systemPrompt);

        // 기존 메시지들 다시 추가
        for (const message of nonSystemMessages) {
            this.history.addMessage(message);
        }
    }

    /**
     * 현재 시스템 프롬프트 반환
     */
    getSystemPrompt(): string {
        return this.systemPrompt;
    }
} 