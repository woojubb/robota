import type {
    RunOptions
} from './types';
import type { AIProvider, Context, Message, ModelResponse, StreamingResponseChunk } from './interfaces/ai-provider';
import type { Logger } from './interfaces/logger';
import type { Memory } from './memory';
import type { ToolProvider } from './tool-provider';

import { SimpleMemory } from './memory';
import { AIProviderManager } from './managers/ai-provider-manager';
import { ToolProviderManager } from './managers/tool-provider-manager';
import { SystemMessageManager } from './managers/system-message-manager';
import { FunctionCallManager, type FunctionCallConfig, type FunctionCallMode } from './managers/function-call-manager';
import { ConversationService } from './services/conversation-service';

/**
 * Robota 설정 인터페이스
 */
export interface RobotaOptions {
    /** 
     * 도구 제공자들 (toolProviders) - MCP, OpenAPI, ZodFunction 등의 도구를 제공하는 Provider들
     * createMcpToolProvider, createOpenAPIToolProvider, createZodFunctionToolProvider 등으로 생성
     */
    toolProviders?: ToolProvider[];

    /** 
     * AI 제공업체들 - 여러 AI provider를 등록
     */
    aiProviders?: Record<string, AIProvider>;

    /** 
     * 현재 사용할 AI 제공업체 이름
     */
    currentProvider?: string;

    /** 
     * 현재 사용할 모델명
     */
    currentModel?: string;

    /** 모델 온도 (선택 사항) */
    temperature?: number;

    /** 최대 토큰 수 (선택 사항) */
    maxTokens?: number;

    /** 시스템 프롬프트 */
    systemPrompt?: string;

    /** 시스템 메시지 배열 */
    systemMessages?: Message[];

    /** 메모리 인터페이스 */
    memory?: any;

    /** 함수 호출 설정 */
    functionCallConfig?: FunctionCallConfig;

    /** 도구 호출 콜백 */
    onToolCall?: (toolName: string, params: any, result: any) => void;

    /** 커스텀 로거 (기본값: console) */
    logger?: Logger;

    /** 디버그 모드 (기본값: false) */
    debug?: boolean;
}

/**
 * Robota의 메인 클래스 (리팩토링 버전)
 * 에이전트를 초기화하고 실행하는 인터페이스 제공
 * 
 * @example
 * ```ts
 * const robota = new Robota({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
 * });
 * 
 * const response = await robota.run('안녕하세요!');
 * ```
 */
export class Robota {
    // 매니저들
    private aiProviderManager: AIProviderManager;
    private toolProviderManager: ToolProviderManager;
    private systemMessageManager: SystemMessageManager;
    private functionCallManager: FunctionCallManager;
    private conversationService: ConversationService;

    // 기본 설정
    private memory: Memory;
    private onToolCall?: (toolName: string, params: any, result: any) => void;
    private logger: Logger;
    private debug: boolean;

    /**
     * Robota 인스턴스 생성
     * 
     * @param options - Robota 초기화 옵션
     */
    constructor(options: RobotaOptions) {
        // 기본 설정
        this.memory = options.memory || new SimpleMemory();
        this.onToolCall = options.onToolCall;
        this.logger = options.logger || console;
        this.debug = options.debug || false;

        // 매니저들 초기화
        this.aiProviderManager = new AIProviderManager();
        this.toolProviderManager = new ToolProviderManager(
            this.logger,
            options.functionCallConfig?.allowedFunctions
        );
        this.systemMessageManager = new SystemMessageManager();
        this.functionCallManager = new FunctionCallManager(options.functionCallConfig);
        this.conversationService = new ConversationService(
            options.temperature,
            options.maxTokens,
            this.logger,
            this.debug
        );

        // AI 제공업체들 등록
        if (options.aiProviders) {
            for (const [name, aiProvider] of Object.entries(options.aiProviders)) {
                this.aiProviderManager.addProvider(name, aiProvider);
            }
        }

        // 현재 AI 설정
        if (options.currentProvider && options.currentModel) {
            this.aiProviderManager.setCurrentAI(options.currentProvider, options.currentModel);
        }

        // Tool Provider들 등록
        if (options.toolProviders) {
            this.toolProviderManager.addProviders(options.toolProviders);
        }

        // 시스템 메시지 설정
        if (options.systemMessages) {
            this.systemMessageManager.setSystemMessages(options.systemMessages);
        } else if (options.systemPrompt) {
            this.systemMessageManager.setSystemPrompt(options.systemPrompt);
        }
    }

    // ============================================================
    // AI Provider 관리 (위임)
    // ============================================================

    /**
     * AI 제공업체 추가
     */
    addAIProvider(name: string, aiProvider: AIProvider): void {
        this.aiProviderManager.addProvider(name, aiProvider);
    }

    /**
     * 현재 AI 제공업체와 모델 설정
     */
    setCurrentAI(providerName: string, model: string): void {
        this.aiProviderManager.setCurrentAI(providerName, model);
    }

    /**
     * 등록된 AI 제공업체들과 사용 가능한 모델들 반환
     */
    getAvailableAIs(): Record<string, string[]> {
        return this.aiProviderManager.getAvailableAIs();
    }

    /**
     * 현재 설정된 AI 제공업체와 모델 반환
     */
    getCurrentAI(): { provider?: string; model?: string } {
        return this.aiProviderManager.getCurrentAI();
    }

    // ============================================================
    // 시스템 메시지 관리 (위임)
    // ============================================================

    /**
     * 단일 시스템 프롬프트 설정
     */
    setSystemPrompt(prompt: string): void {
        this.systemMessageManager.setSystemPrompt(prompt);
    }

    /**
     * 여러 시스템 메시지 설정
     */
    setSystemMessages(messages: Message[]): void {
        this.systemMessageManager.setSystemMessages(messages);
    }

    /**
     * 기존 시스템 메시지에 새 시스템 메시지 추가
     */
    addSystemMessage(content: string): void {
        this.systemMessageManager.addSystemMessage(content);
    }

    // ============================================================
    // 함수 호출 관리 (위임)
    // ============================================================

    /**
     * 함수 호출 모드 설정
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        this.functionCallManager.setFunctionCallMode(mode);
    }

    /**
     * 함수 호출 설정 구성
     */
    configureFunctionCall(config: {
        mode?: FunctionCallMode;
        maxCalls?: number;
        timeout?: number;
        allowedFunctions?: string[];
    }): void {
        this.functionCallManager.configure(config);

        // Tool Provider Manager에도 허용된 함수 목록 업데이트
        if (config.allowedFunctions) {
            this.toolProviderManager.setAllowedFunctions(config.allowedFunctions);
        }
    }

    // ============================================================
    // 실행 메서드
    // ============================================================

    /**
     * 텍스트 프롬프트 실행
     */
    async run(prompt: string, options: RunOptions = {}): Promise<string> {
        const userMessage: Message = {
            role: 'user',
            content: prompt
        };
        this.memory.addMessage(userMessage);

        const context = this.conversationService.prepareContext(
            this.memory,
            this.systemMessageManager.getSystemPrompt(),
            this.systemMessageManager.getSystemMessages(),
            options
        );

        const response = await this.generateResponse(context, options);

        // assistant 응답을 memory에 추가
        const assistantMessage: Message = {
            role: 'assistant',
            content: response.content || ''
        };
        this.memory.addMessage(assistantMessage);

        return response.content || '';
    }

    /**
     * 채팅 메시지 처리 및 응답 생성
     */
    async chat(message: string, options: RunOptions = {}): Promise<string> {
        const userMessage: Message = {
            role: 'user',
            content: message
        };
        this.memory.addMessage(userMessage);

        const context = this.conversationService.prepareContext(
            this.memory,
            this.systemMessageManager.getSystemPrompt(),
            this.systemMessageManager.getSystemMessages(),
            options
        );

        const response = await this.generateResponse(context, options);

        const assistantMessage: Message = {
            role: 'assistant',
            content: response.content || ''
        };
        this.memory.addMessage(assistantMessage);

        return response.content || '';
    }

    /**
     * 스트리밍 응답 생성
     */
    async runStream(prompt: string, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        const userMessage: Message = {
            role: 'user',
            content: prompt
        };
        this.memory.addMessage(userMessage);

        const context = this.conversationService.prepareContext(
            this.memory,
            this.systemMessageManager.getSystemPrompt(),
            this.systemMessageManager.getSystemMessages(),
            options
        );

        return this.generateStream(context, options);
    }

    /**
     * 응답 메시지 추가
     */
    addResponseToMemory(response: ModelResponse): void {
        const assistantMessage: Message = {
            role: 'assistant',
            content: response.content || ''
        };
        this.memory.addMessage(assistantMessage);
    }

    /**
     * 메모리 초기화
     */
    clearMemory(): void {
        this.memory.clear();
    }

    // ============================================================
    // 내부 헬퍼 메서드
    // ============================================================

    /**
     * 응답 생성 (내부용)
     */
    private async generateResponse(context: any, options: RunOptions = {}): Promise<ModelResponse> {
        if (!this.aiProviderManager.isConfigured()) {
            throw new Error('현재 AI 제공업체와 모델이 설정되지 않았습니다. setCurrentAI() 메서드를 사용하여 설정하세요.');
        }

        const currentAiProvider = this.aiProviderManager.getCurrentProvider()!;
        const currentModel = this.aiProviderManager.getCurrentModel()!;

        // 함수 호출 모드가 옵션에 없으면 기본 모드 사용
        const enhancedOptions = {
            ...options,
            functionCallMode: options.functionCallMode || this.functionCallManager.getDefaultMode()
        };

        return this.conversationService.generateResponse(
            currentAiProvider,
            currentModel,
            context,
            enhancedOptions,
            this.toolProviderManager.getAvailableTools(),
            async (toolName: string, params: any) => {
                const result = await this.toolProviderManager.callTool(toolName, params);

                // 콜백 실행
                if (this.onToolCall) {
                    this.onToolCall(toolName, params, result);
                }

                return result;
            }
        );
    }

    /**
     * 스트리밍 응답 생성 (내부용)
     */
    private async generateStream(context: any, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        if (!this.aiProviderManager.isConfigured()) {
            throw new Error('현재 AI 제공업체와 모델이 설정되지 않았습니다. setCurrentAI() 메서드를 사용하여 설정하세요.');
        }

        const currentAiProvider = this.aiProviderManager.getCurrentProvider()!;
        const currentModel = this.aiProviderManager.getCurrentModel()!;

        return this.conversationService.generateStream(
            currentAiProvider,
            currentModel,
            context,
            options,
            this.toolProviderManager.getAvailableTools()
        );
    }

    /**
     * 도구 호출 (공개 API)
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        return this.toolProviderManager.callTool(toolName, parameters);
    }

    /**
     * 사용 가능한 도구 목록 반환
     */
    getAvailableTools(): any[] {
        return this.toolProviderManager.getAvailableTools();
    }

    /**
     * 리소스 해제
     */
    async close(): Promise<void> {
        await this.aiProviderManager.close();
    }
} 