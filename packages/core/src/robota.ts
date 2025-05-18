import { logger } from './utils';
import {
    Context,
    FunctionCallMode,
    FunctionSchema,
    Message,
    ModelResponse,
    RunOptions,
    RobotaOptions,
    StreamingResponseChunk,
    AIClient
} from './types';
import { SimpleMemory } from './memory';
import type { Memory } from './memory';
import type { ModelContextProtocol } from './model-context-protocol';

/**
 * Robota의 메인 클래스
 * 에이전트를 초기화하고 실행하는 인터페이스 제공
 * 
 * @example
 * ```ts
 * const robota = new Robota({
 *   provider: new OpenAIProvider({
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
    private provider?: ModelContextProtocol;
    private aiClient?: AIClient; // 단일 AI 클라이언트
    private model?: string;
    private temperature?: number;
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
        if (!options.provider && !options.aiClient) {
            throw new Error('Provider 또는 aiClient 중 하나는 반드시 제공해야 합니다.');
        }

        this.provider = options.provider;
        this.aiClient = options.aiClient;
        this.model = options.model;
        this.temperature = options.temperature;
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
        // Provider가 설정된 경우 기존 로직 사용
        if (this.provider) {
            return this.provider.chat(context, {
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                functionCallMode: options.functionCallMode || this.functionCallConfig.defaultMode,
                forcedFunction: options.forcedFunction,
                forcedArguments: options.forcedArguments
            });
        }

        // AI 클라이언트만 설정된 경우 처리
        if (this.aiClient) {
            const { messages, systemPrompt } = context;

            // 시스템 프롬프트 추가 (없는 경우)
            const messagesWithSystem = systemPrompt && !messages.some(m => m.role === 'system')
                ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
                : messages;

            // 요청 옵션 구성
            const requestOptions: any = {
                messages: messagesWithSystem.map(m => ({
                    role: m.role,
                    content: m.content,
                    function_call: m.functionCall,
                    name: m.name
                })),
                temperature: options.temperature || this.temperature || 0.7,
            };

            if (options.maxTokens) {
                requestOptions.max_tokens = options.maxTokens;
            }

            if (this.model) {
                requestOptions.model = this.model;
            }

            // 클라이언트 타입에 따른 처리
            try {
                switch (this.aiClient.type) {
                    case 'openai': {
                        // OpenAI API를 사용하여 응답 생성
                        const openaiResponse = await this.aiClient.instance.chat.completions.create(requestOptions);
                        return {
                            content: openaiResponse.choices[0]?.message?.content || "",
                            functionCall: openaiResponse.choices[0]?.message?.function_call ? {
                                name: openaiResponse.choices[0].message.function_call.name,
                                arguments: typeof openaiResponse.choices[0].message.function_call.arguments === 'string'
                                    ? JSON.parse(openaiResponse.choices[0].message.function_call.arguments)
                                    : openaiResponse.choices[0].message.function_call.arguments
                            } : undefined,
                            usage: openaiResponse.usage ? {
                                promptTokens: openaiResponse.usage.prompt_tokens,
                                completionTokens: openaiResponse.usage.completion_tokens,
                                totalTokens: openaiResponse.usage.total_tokens
                            } : undefined
                        };
                    }
                    case 'anthropic': {
                        // Anthropic API를 사용하여 응답 생성
                        const anthropicResponse = await this.aiClient.instance.messages.create(requestOptions);
                        return {
                            content: anthropicResponse.content[0]?.text || "",
                            // Anthropic의 함수 호출 처리는 다를 수 있음
                            functionCall: undefined,
                            usage: undefined
                        };
                    }
                    default:
                        throw new Error(`지원되지 않는 AI 클라이언트 타입: ${this.aiClient.type}`);
                }
            } catch (error) {
                logger.error('AI 클라이언트 호출 중 오류 발생:', error);
                throw new Error(`AI 클라이언트 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        throw new Error('유효한 Provider, AI 클라이언트가 설정되지 않았습니다.');
    }

    /**
     * 스트리밍 응답 생성
     */
    private async generateStream(context: Context, options: RunOptions = {}): Promise<AsyncIterable<StreamingResponseChunk>> {
        // Provider가 설정된 경우 기존 로직 사용
        if (this.provider) {
            return this.provider.chatStream(context, {
                temperature: options.temperature,
                maxTokens: options.maxTokens,
                functionCallMode: options.functionCallMode || this.functionCallConfig.defaultMode,
                forcedFunction: options.forcedFunction,
                forcedArguments: options.forcedArguments
            });
        }

        // AI 클라이언트 스트리밍 처리 로직
        if (this.aiClient) {
            // 클라이언트 타입에 따른 스트리밍 처리
            switch (this.aiClient.type) {
                case 'openai':
                    // OpenAI 스트리밍 처리 로직
                    // TODO: OpenAI 스트림 API 구현
                    break;
                case 'anthropic':
                    // Anthropic 스트리밍 처리 로직
                    // TODO: Anthropic 스트림 API 구현
                    break;
                default:
                    // 기타 제공업체 스트리밍 처리
                    // TODO: 커스텀 스트리밍 처리 구현
                    break;
            }
        }

        throw new Error('유효한 Provider, 스트리밍을 지원하는 AI 클라이언트가 설정되지 않았습니다.');
    }

    /**
 * 리소스 해제
 */
    async close(): Promise<void> {
        try {
            if (this.aiClient?.close) {
                await this.aiClient.close();
            }
            if (this.aiClient?.transport?.close) {
                await this.aiClient.transport.close();
            }
        } catch (error) {
            logger.error('리소스 해제 중 오류 발생:', error);
        }
    }
} 