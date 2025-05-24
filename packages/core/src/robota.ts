import { logger } from './utils';
import {
    Context,
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
 * Robota 설정 인터페이스
 */
export interface RobotaOptions {
    /** 
     * 도구 제공자 (toolProvider) - MCP, OpenAPI, ZodFunction 등의 도구를 제공하는 Provider
     * createMcpToolProvider, createOpenAPIToolProvider, createZodFunctionToolProvider 등으로 생성
     */
    provider?: ToolProvider;

    /** 
     * AI 클라이언트 - OpenAI, Anthropic 등의 외부 라이브러리 클라이언트 인스턴스
     */
    aiClient: any;

    /** 사용할 모델명 */
    model: string;

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
    private provider?: ToolProvider; // 도구 제공자 (toolProvider)
    private aiClient: any; // AI 클라이언트 (OpenAI, Anthropic 등)
    private model: string;
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

    /**
     * Robota 인스턴스 생성
     * 
     * @param options - Robota 초기화 옵션
     */
    constructor(options: RobotaOptions) {
        if (!options.aiClient) {
            throw new Error('aiClient는 반드시 제공해야 합니다.');
        }
        if (!options.model) {
            throw new Error('model은 반드시 제공해야 합니다.');
        }

        this.provider = options.provider; // 도구 제공자 (toolProvider)
        this.aiClient = options.aiClient; // AI 클라이언트
        this.model = options.model;
        this.temperature = options.temperature;
        this.maxTokens = options.maxTokens;
        this.systemPrompt = options.systemPrompt;
        this.memory = options.memory || new SimpleMemory();
        this.onToolCall = options.onToolCall;

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

        if (response.functionCall && options.functionCallMode !== 'disabled') {
            // 함수 호출은 제공업체가 처리해야 함
            logger.warn('함수 호출은 Provider 객체에서 처리되어야 합니다.');
            return response.content || '';
        }

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

        if (response.functionCall && options.functionCallMode !== 'disabled') {
            // 함수 호출은 제공업체가 처리해야 함
            logger.warn('함수 호출은 Provider 객체에서 처리되어야 합니다.');
            return response.content || '';
        }

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
        try {
            const { messages, systemPrompt } = context;

            // 시스템 프롬프트 추가 (없는 경우)
            const messagesWithSystem = systemPrompt && !messages.some(m => m.role === 'system')
                ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
                : messages;

            // OpenAI 형식으로 메시지 변환
            const formattedMessages = messagesWithSystem.map(m => ({
                role: m.role,
                content: m.content,
                name: m.name
            }));

            // OpenAI API 요청 옵션 구성
            const completionOptions: any = {
                model: this.model,
                messages: formattedMessages,
                temperature: options.temperature ?? this.temperature ?? 0.7,
                max_tokens: options.maxTokens ?? this.maxTokens
            };

            // 도구 제공자가 있을 경우 함수 정의 추가
            if (this.provider?.functions) {
                completionOptions.tools = this.provider.functions.map(fn => ({
                    type: 'function',
                    function: {
                        name: fn.name,
                        description: fn.description || '',
                        parameters: fn.parameters || { type: 'object', properties: {} }
                    }
                }));
            }

            // OpenAI API 호출
            const response = await this.aiClient.chat.completions.create(completionOptions);

            return {
                content: response.choices[0]?.message?.content || "",
                functionCall: response.choices[0]?.message?.function_call ? {
                    name: response.choices[0].message.function_call.name,
                    arguments: typeof response.choices[0].message.function_call.arguments === 'string'
                        ? JSON.parse(response.choices[0].message.function_call.arguments)
                        : response.choices[0].message.function_call.arguments
                } : undefined,
                usage: response.usage ? {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens
                } : undefined,
                metadata: {
                    model: response.model,
                    finishReason: response.choices[0].finish_reason
                }
            };
        } catch (error) {
            logger.error('AI 클라이언트 호출 중 오류 발생:', error);
            throw new Error(`AI 클라이언트 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 스트리밍 응답 생성
     */
    private async generateStream(context: Context, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        const { messages, systemPrompt } = context;

        // 시스템 프롬프트 추가 (없는 경우)
        const messagesWithSystem = systemPrompt && !messages.some(m => m.role === 'system')
            ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
            : messages;

        // OpenAI 형식으로 메시지 변환
        const formattedMessages = messagesWithSystem.map(m => ({
            role: m.role,
            content: m.content,
            name: m.name
        }));

        // OpenAI API 요청 옵션 구성
        const completionOptions: any = {
            model: this.model,
            messages: formattedMessages,
            temperature: options.temperature ?? this.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? this.maxTokens,
            stream: true
        };

        // 도구 제공자가 있을 경우 함수 정의 추가
        if (this.provider?.functions) {
            completionOptions.tools = this.provider.functions.map(fn => ({
                type: 'function',
                function: {
                    name: fn.name,
                    description: fn.description || '',
                    parameters: fn.parameters || { type: 'object', properties: {} }
                }
            }));
        }

        try {
            const stream = await this.aiClient.chat.completions.create(completionOptions);

            async function* generateChunks() {
                for await (const chunk of stream) {
                    const delta = chunk.choices[0].delta;
                    yield {
                        content: delta.content || undefined,
                        isComplete: chunk.choices[0].finish_reason !== null,
                        functionCall: delta.function_call ? {
                            name: delta.function_call.name,
                            arguments: delta.function_call.arguments
                        } : undefined
                    } as StreamingResponseChunk;
                }
            }

            return generateChunks();
        } catch (error) {
            logger.error('스트리밍 API 호출 중 오류 발생:', error);
            throw new Error(`스트리밍 API 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 도구 호출
     * 
     * 설정된 도구 제공자를 통해 도구를 호출합니다.
     * 
     * @param toolName 호출할 도구 이름
     * @param parameters 도구에 전달할 파라미터
     * @returns 도구 호출 결과
     * @throws 도구 제공자가 설정되지 않았거나 도구 호출 실패 시 오류
     */
    async callTool(toolName: string, parameters: Record<string, any>): Promise<any> {
        if (!this.provider) {
            throw new Error('도구 제공자(toolProvider)가 설정되지 않았습니다.');
        }

        try {
            // 도구 호출 전 파라미터 검증 (필요시)
            if (this.functionCallConfig.allowedFunctions &&
                !this.functionCallConfig.allowedFunctions.includes(toolName)) {
                throw new Error(`도구 '${toolName}'은(는) 허용되지 않습니다.`);
            }

            // 도구 제공자를 통해 도구 호출
            const result = await this.provider.callTool(toolName, parameters);

            // 도구 호출 콜백 실행 (설정된 경우)
            if (this.onToolCall) {
                this.onToolCall(toolName, parameters, result);
            }

            return result;
        } catch (error) {
            logger.error(`도구 '${toolName}' 호출 중 오류:`, error);
            throw new Error(`도구 호출 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 사용 가능한 도구 목록 반환
     * 
     * @returns 도구 스키마 목록 또는 빈 배열
     */
    getAvailableTools(): FunctionSchema[] {
        return this.provider?.functions || [];
    }

    /**
     * 리소스 해제
     */
    async close(): Promise<void> {
        try {
            // 대부분의 AI 클라이언트는 특별한 종료 메서드가 없으므로 빈 함수로 구현
            if (this.aiClient?.close && typeof this.aiClient.close === 'function') {
                await this.aiClient.close();
            }
        } catch (error) {
            logger.error('리소스 해제 중 오류 발생:', error);
        }
    }
} 