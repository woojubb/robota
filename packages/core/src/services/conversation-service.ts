import type {
    RunOptions
} from '../types';
import type { AIProvider, Context, Message, ModelResponse, StreamingResponseChunk } from '../interfaces/ai-provider';
import type { Logger } from '../interfaces/logger';
import type { Memory } from '../memory';
import { logger } from '../utils';

/**
 * 대화 서비스 클래스
 * AI와의 대화 처리를 담당합니다.
 */
export class ConversationService {
    private temperature?: number;
    private maxTokens?: number;
    private logger: Logger;
    private debug: boolean;

    constructor(
        temperature?: number,
        maxTokens?: number,
        logger: Logger = console,
        debug: boolean = false
    ) {
        this.temperature = temperature;
        this.maxTokens = maxTokens;
        this.logger = logger;
        this.debug = debug;
    }

    /**
     * 컨텍스트 준비
     * 
     * @param memory - 메모리 인스턴스
     * @param systemPrompt - 옵션 시스템 프롬프트
     * @param systemMessages - 시스템 메시지들
     * @param options - 실행 옵션
     */
    prepareContext(
        memory: Memory,
        systemPrompt?: string,
        systemMessages?: Message[],
        options: RunOptions = {}
    ): Context {
        const messages = memory ? memory.getMessages() : [];

        const context: Context = {
            messages
        };

        // 시스템 메시지 처리
        if (options.systemPrompt) {
            context.systemPrompt = options.systemPrompt;
        } else if (systemMessages && systemMessages.length > 0) {
            context.systemMessages = systemMessages;
        } else if (systemPrompt) {
            context.systemPrompt = systemPrompt;
        }

        return context;
    }

    /**
     * 응답 생성
     * 
     * @param aiProvider - AI 제공업체
     * @param model - 모델명
     * @param context - 대화 컨텍스트
     * @param options - 실행 옵션
     * @param availableTools - 사용 가능한 도구들
     * @param onToolCall - 도구 호출 함수
     */
    async generateResponse(
        aiProvider: AIProvider,
        model: string,
        context: Context,
        options: RunOptions = {},
        availableTools: any[] = [],
        onToolCall?: (toolName: string, params: any) => Promise<any>
    ): Promise<ModelResponse> {
        try {
            // AI 제공업체를 통해 응답 생성
            const response = await aiProvider.chat(model, context, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools,
                functionCallMode: options.functionCallMode,
                forcedFunction: options.forcedFunction,
                forcedArguments: options.forcedArguments
            });

            // 함수 호출이 있는 경우 자동으로 실행
            if (response.functionCall && options.functionCallMode !== 'disabled' && onToolCall) {
                return await this.handleFunctionCall(
                    response,
                    context,
                    aiProvider,
                    model,
                    options,
                    availableTools,
                    onToolCall
                );
            }

            return response;
        } catch (error) {
            logger.error('AI 클라이언트 호출 중 오류 발생:', error);
            throw new Error(`AI 클라이언트 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * 함수 호출 처리
     */
    private async handleFunctionCall(
        response: ModelResponse,
        context: Context,
        aiProvider: AIProvider,
        model: string,
        options: RunOptions,
        availableTools: any[],
        onToolCall: (toolName: string, params: any) => Promise<any>
    ): Promise<ModelResponse> {
        const { name, arguments: args } = response.functionCall!;

        try {
            // arguments가 string이면 JSON 파싱, 아니면 그대로 사용
            const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

            // 도구 호출 로깅
            if (this.debug) {
                this.logger.info(`🔧 [도구 호출] ${name}`, parsedArgs);
            }

            // 도구 호출
            const toolResult = await onToolCall(name, parsedArgs);

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
            const finalResponse = await aiProvider.chat(model, newContext, {
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
            const errorResponse = await aiProvider.chat(model, errorContext, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools
            });

            return errorResponse;
        }
    }

    /**
     * 스트리밍 응답 생성
     */
    async generateStream(
        aiProvider: AIProvider,
        model: string,
        context: Context,
        options: RunOptions = {},
        availableTools: any[] = []
    ): Promise<AsyncIterable<StreamingResponseChunk>> {
        if (!aiProvider.chatStream) {
            throw new Error(`AI 제공업체는 스트리밍을 지원하지 않습니다.`);
        }

        try {
            return aiProvider.chatStream(model, context, {
                ...options,
                temperature: options.temperature ?? this.temperature,
                maxTokens: options.maxTokens ?? this.maxTokens,
                tools: availableTools
            });
        } catch (error) {
            this.logger.error('스트리밍 API 호출 중 오류 발생:', error);
            throw new Error(`스트리밍 API 호출 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
} 