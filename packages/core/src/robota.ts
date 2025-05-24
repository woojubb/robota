import { logger } from './utils';
import {
    FunctionCallMode,
    FunctionSchema,
    Message,
    ModelResponse,
    RunOptions,
    StreamingResponseChunk,
    FunctionCallConfig
} from './types';
import { SimpleMemory } from './memory';
import type { Memory } from './memory';
import type { ToolProvider } from './tool-provider';

/**
 * 대화 컨텍스트 인터페이스
 */
export interface Context {
    messages: Message[];
    systemPrompt?: string;
    systemMessages?: Message[];
    metadata?: Record<string, any>;
}

/**
 * AI 제공업체 인터페이스 (통합 래퍼)
 */
export interface AIProvider {
    /** 제공업체 이름 */
    name: string;

    /** 사용 가능한 모델 목록 */
    availableModels: string[];

    /** 채팅 요청 */
    chat(model: string, context: Context, options?: any): Promise<ModelResponse>;

    /** 스트리밍 채팅 요청 (선택 사항) */
    chatStream?(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk, void, unknown>;

    /** 리소스 해제 (선택 사항) */
    close?(): Promise<void>;
}

/**
 * Logger 인터페이스
 */
export interface Logger {
    info(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
}

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
 * Robota의 메인 클래스
 * 에이전트를 초기화하고 실행하는 인터페이스 제공
 * 
 * @example
 * ```ts
 * const robota = new Robota({
 *   aiClient: new OpenAIProvider({
 *     model: 'gpt-4',
 *     client: openaiClient
 *   }),
 *   systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
 * });
 * 
 * const response = await robota.run('안녕하세요!');
 * ```
 */
export class Robota {
    private toolProviders: ToolProvider[]; // 도구 제공자들
    private aiProviders: Record<string, AIProvider> = {}; // AI 제공업체들
    private currentProvider?: string; // 현재 사용 중인 AI 제공업체
    private currentModel?: string; // 현재 사용 중인 모델
    private temperature?: number;
    private maxTokens?: number;
    private systemPrompt?: string;
    private systemMessages?: Message[];
    private memory: Memory;
    private functionCallConfig: {
        defaultMode?: FunctionCallMode;
        maxCalls: number;
        timeout: number;
        allowedFunctions?: string[];
    };
    private onToolCall?: (toolName: string, params: any, result: any) => void;
    private logger: Logger;
    private debug: boolean;

    /**
     * Robota 인스턴스 생성
     * 
     * @param options - Robota 초기화 옵션
     */
    constructor(options: RobotaOptions) {
        this.toolProviders = options.toolProviders || [];
        this.aiProviders = options.aiProviders || {};
        this.currentProvider = options.currentProvider;
        this.currentModel = options.currentModel;
        this.temperature = options.temperature;
        this.maxTokens = options.maxTokens;
        this.systemPrompt = options.systemPrompt;
        this.memory = options.memory || new SimpleMemory();
        this.onToolCall = options.onToolCall;
        this.logger = options.logger || console;
        this.debug = options.debug || false;

        // 시스템 메시지 배열 초기화
        if (options.systemMessages) {
            this.systemMessages = options.systemMessages;
        } else if (options.systemPrompt) {
            this.systemMessages = [{ role: 'system', content: options.systemPrompt }];
        }

        // 함수 호출 설정 초기화
        this.functionCallConfig = {
            defaultMode: options.functionCallConfig?.defaultMode || 'auto',
            maxCalls: options.functionCallConfig?.maxCalls || 10,
            timeout: options.functionCallConfig?.timeout || 30000,
            allowedFunctions: options.functionCallConfig?.allowedFunctions
        };
    }

    // ============================================================
    // AI Provider 관리
    // ============================================================

    /**
     * AI 제공업체 추가
     * 
     * @param name - 제공업체 이름
     * @param provider - AI 제공업체 인스턴스
     */
    addAIProvider(name: string, provider: AIProvider): void {
        this.aiProviders[name] = provider;
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

        const provider = this.aiProviders[providerName];
        if (!provider.availableModels.includes(model)) {
            throw new Error(`모델 '${model}'은 제공업체 '${providerName}'에서 지원되지 않습니다. 사용 가능한 모델: ${provider.availableModels.join(', ')}`);
        }

        this.currentProvider = providerName;
        this.currentModel = model;
    }

    /**
     * 등록된 AI 제공업체들과 사용 가능한 모델들 반환
     */
    getAvailableAIs(): Record<string, string[]> {
        const result: Record<string, string[]> = {};
        for (const [name, provider] of Object.entries(this.aiProviders)) {
            result[name] = provider.availableModels;
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

    // ============================================================
    // 시스템 메시지 관리
    // ============================================================

    /**
     * 단일 시스템 프롬프트 설정
     * 
     * @param prompt - 시스템 프롬프트 내용
     */
    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
        this.systemMessages = [{ role: 'system', content: prompt }];
    }

    /**
     * 여러 시스템 메시지 설정
     * 
     * @param messages - 시스템 메시지 배열
     */
    setSystemMessages(messages: Message[]): void {
        this.systemPrompt = undefined;
        this.systemMessages = messages;
    }

    /**
     * 기존 시스템 메시지에 새 시스템 메시지 추가
     * 
     * @param content - 추가할 시스템 메시지 내용
     */
    addSystemMessage(content: string): void {
        // systemPrompt 설정이 있고 systemMessages가 없거나 systemPrompt 설정과 동일한 메시지 하나만 있는 경우
        if (this.systemPrompt) {
            if (!this.systemMessages ||
                (this.systemMessages.length === 1 &&
                    this.systemMessages[0].role === 'system' &&
                    this.systemMessages[0].content === this.systemPrompt)) {
                this.systemMessages = [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'system', content }
                ];
            } else {
                this.systemMessages.push({ role: 'system', content });
            }
            this.systemPrompt = undefined;
        } else {
            if (!this.systemMessages) {
                this.systemMessages = [];
            }
            this.systemMessages.push({ role: 'system', content });
        }
    }

    // ============================================================
    // 함수 호출 관리
    // ============================================================

    /**
     * 함수 호출 모드 설정
     * 
     * @param mode - 함수 호출 모드 ('auto', 'force', 'disabled')
     */
    setFunctionCallMode(mode: FunctionCallMode): void {
        this.functionCallConfig.defaultMode = mode;
    }

    /**
     * 함수 호출 설정 구성
     * 
     * @param config - 함수 호출 구성 옵션
     */
    configureFunctionCall(config: {
        mode?: FunctionCallMode;
        maxCalls?: number;
        timeout?: number;
        allowedFunctions?: string[];
    }): void {
        if (config.mode) {
            this.functionCallConfig.defaultMode = config.mode;
        }
        if (config.maxCalls !== undefined) {
            this.functionCallConfig.maxCalls = config.maxCalls;
        }
        if (config.timeout !== undefined) {
            this.functionCallConfig.timeout = config.timeout;
        }
        if (config.allowedFunctions) {
            this.functionCallConfig.allowedFunctions = config.allowedFunctions;
        }
    }

    // ============================================================
    // 실행 메서드
    // ============================================================

    /**
     * 텍스트 프롬프트 실행
     * 
     * @param prompt - 사용자 프롬프트
     * @param options - 실행 옵션
     * @returns 모델 응답 내용
     */
    async run(prompt: string, options: RunOptions = {}): Promise<string> {
        const context = this.initializeContext(prompt, options);
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
     * 
     * @param message - 사용자 메시지
     * @param options - 실행 옵션
     * @returns 모델 응답 내용
     */
    async chat(message: string, options: RunOptions = {}): Promise<string> {
        const userMessage: Message = {
            role: 'user',
            content: message
        };
        this.memory.addMessage(userMessage);

        const context = this.prepareContext(options);
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
     * 
     * @param prompt - 사용자 프롬프트
     * @param options - 실행 옵션
     * @returns 스트리밍 응답 청크 이터레이터
     */
    async runStream(prompt: string, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        const context = this.initializeContext(prompt, options);
        return this.generateStream(context, options);
    }

    /**
     * 응답 메시지 추가
     * 
     * @param response - 모델 응답
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
     * 컨텍스트 초기화
     * 
     * @private
     * @param prompt - 사용자 프롬프트
     * @param options - 실행 옵션
     * @returns 초기화된 컨텍스트
     */
    private initializeContext(prompt: string, options: RunOptions): Context {
        const userMessage: Message = {
            role: 'user',
            content: prompt
        };

        // 사용자 메시지 추가
        this.memory.addMessage(userMessage);

        return this.prepareContext(options);
    }

    /**
     * 컨텍스트 준비
     * 
     * @private
     * @param options - 실행 옵션
     * @returns 준비된 컨텍스트
     */
    private prepareContext(options: RunOptions): Context {
        const messages = this.memory ? this.memory.getMessages() : [];

        const context: Context = {
            messages
        };

        // 시스템 메시지 처리
        if (options.systemPrompt) {
            context.systemPrompt = options.systemPrompt;
        } else if (this.systemMessages && this.systemMessages.length > 0) {
            // 시스템 메시지가 있으면 메시지 배열 앞에 추가
            context.messages = [...this.systemMessages, ...messages];
        } else if (this.systemPrompt) {
            context.systemPrompt = this.systemPrompt;
        }

        return context;
    }

    /**
     * 응답 생성
     * 
     * @param context - 대화 컨텍스트
     * @param options - 모델 실행 옵션
     * @returns - AI 모델의 응답
     */
    private async generateResponse(context: Context, options: RunOptions = {}): Promise<ModelResponse> {
        if (!this.currentProvider || !this.currentModel) {
            throw new Error('현재 AI 제공업체와 모델이 설정되지 않았습니다. setCurrentAI() 메서드를 사용하여 설정하세요.');
        }

        const provider = this.aiProviders[this.currentProvider];
        if (!provider) {
            throw new Error(`AI 제공업체 '${this.currentProvider}'를 찾을 수 없습니다.`);
        }

        try {
            // 사용 가능한 도구 목록 가져오기
            const availableTools = this.getAvailableTools();

            // AI 제공업체를 통해 응답 생성
            const response = await provider.chat(this.currentModel, context, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools
            });

            // 함수 호출이 있는 경우 자동으로 실행
            if (response.functionCall && options.functionCallMode !== 'disabled') {
                const { name, arguments: args } = response.functionCall;

                try {
                    // arguments가 string이면 JSON 파싱, 아니면 그대로 사용
                    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

                    // 도구 호출 로깅
                    if (this.debug) {
                        this.logger.info(`🔧 [도구 호출] ${name}`, parsedArgs);
                    }

                    // 도구 호출
                    const toolResult = await this.callTool(name, parsedArgs);

                    // 도구 결과 로깅
                    if (this.debug) {
                        this.logger.info(`✅ [도구 결과] ${name}`, toolResult);
                    }

                    // 함수 호출 결과를 메시지에 추가
                    const functionResultMessage: Message = {
                        role: 'function',
                        name: name,
                        content: JSON.stringify(toolResult)
                    };

                    // 새로운 컨텍스트 생성 (원본 + 어시스턴트 응답 + 함수 결과)
                    const newContext: Context = {
                        ...context,
                        messages: [
                            ...context.messages,
                            {
                                role: 'assistant',
                                content: response.content || '',
                                functionCall: response.functionCall
                            },
                            functionResultMessage
                        ]
                    };

                    // 함수 결과를 포함한 최종 응답 생성
                    const finalResponse = await provider.chat(this.currentModel, newContext, {
                        ...options,
                        temperature: options.temperature ?? this.temperature,
                        maxTokens: options.maxTokens ?? this.maxTokens,
                        tools: availableTools
                    });

                    return finalResponse;
                } catch (toolError) {
                    logger.error('도구 호출 중 오류:', toolError);

                    // 도구 호출 오류를 함수 결과로 추가
                    const errorMessage: Message = {
                        role: 'function',
                        name: name,
                        content: JSON.stringify({ error: toolError instanceof Error ? toolError.message : String(toolError) })
                    };

                    const errorContext: Context = {
                        ...context,
                        messages: [
                            ...context.messages,
                            {
                                role: 'assistant',
                                content: response.content || '',
                                functionCall: response.functionCall
                            },
                            errorMessage
                        ]
                    };

                    // 오류를 포함한 응답 생성
                    const errorResponse = await provider.chat(this.currentModel, errorContext, {
                        ...options,
                        temperature: options.temperature ?? this.temperature,
                        maxTokens: options.maxTokens ?? this.maxTokens,
                        tools: availableTools
                    });

                    return errorResponse;
                }
            }

            return response;
        } catch (error) {
            logger.error('AI 클라이언트 호출 중 오류 발생:', error);
            throw new Error(`AI 클라이언트 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 스트리밍 응답 생성
     */
    private async generateStream(context: Context, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        if (!this.currentProvider || !this.currentModel) {
            throw new Error('현재 AI 제공업체와 모델이 설정되지 않았습니다. setCurrentAI() 메서드를 사용하여 설정하세요.');
        }

        const provider = this.aiProviders[this.currentProvider];
        if (!provider) {
            throw new Error(`AI 제공업체 '${this.currentProvider}'를 찾을 수 없습니다.`);
        }

        if (!provider.chatStream) {
            throw new Error(`AI 제공업체 '${this.currentProvider}'는 스트리밍을 지원하지 않습니다.`);
        }

        try {
            return provider.chatStream(this.currentModel, context, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: this.getAvailableTools()
            });
        } catch (error) {
            this.logger.error('스트리밍 API 호출 중 오류 발생:', error);
            throw new Error(`스트리밍 API 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 도구 호출
     * 
     * 설정된 도구 제공자들을 통해 도구를 호출합니다.
     * 
     * @param toolName 호출할 도구 이름
     * @param parameters 도구에 전달할 파라미터
     * @returns 도구 호출 결과
     * @throws 도구 제공자가 설정되지 않았거나 도구 호출 실패 시 오류
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        if (this.toolProviders.length === 0) {
            throw new Error('도구 제공자(toolProviders)가 설정되지 않았습니다.');
        }

        try {
            // 도구 호출 전 파라미터 검증 (필요시)
            if (this.functionCallConfig.allowedFunctions &&
                !this.functionCallConfig.allowedFunctions.includes(toolName)) {
                throw new Error(`도구 '${toolName}'은(는) 허용되지 않습니다.`);
            }

            // 모든 provider에서 해당 도구를 찾아서 호출
            for (const provider of this.toolProviders) {
                if (provider.functions?.some(fn => fn.name === toolName)) {
                    const result = await provider.callTool(toolName, parameters);

                    // 도구 호출 콜백 실행 (설정된 경우)
                    if (this.onToolCall) {
                        this.onToolCall(toolName, parameters, result);
                    }

                    return result;
                }
            }

            throw new Error(`도구 '${toolName}'을(를) 찾을 수 없습니다.`);
        } catch (error) {
            this.logger.error(`도구 '${toolName}' 호출 중 오류:`, error);
            throw new Error(`도구 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 사용 가능한 도구 목록 반환
     * 
     * @returns 도구 스키마 목록 또는 빈 배열
     */
    getAvailableTools(): FunctionSchema[] {
        return this.toolProviders.reduce((tools: FunctionSchema[], provider) => {
            if (provider.functions) {
                tools.push(...provider.functions);
            }
            return tools;
        }, []);
    }

    /**
     * 리소스 해제
     */
    async close(): Promise<void> {
        try {
            // 모든 AI 제공업체의 리소스 해제
            for (const [name, provider] of Object.entries(this.aiProviders)) {
                if (provider.close && typeof provider.close === 'function') {
                    await provider.close();
                }
            }
        } catch (error) {
            this.logger.error('리소스 해제 중 오류 발생:', error);
        }
    }
}