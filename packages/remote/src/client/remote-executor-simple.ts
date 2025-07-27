/**
 * Simple RemoteExecutor - Composed from Atomic Components
 * 
 * Facade pattern using pure functions and atomic types
 */

import type { BasicMessage } from '../types/message-types';
import type {
    UniversalMessage,
    AssistantMessage,
    StreamExecutionRequest,
    ChatExecutionRequest,
    ExecutorInterface,
    SimpleLogger,
    ToolCall
} from '@robota-sdk/agents';
import { SilentLogger } from '@robota-sdk/agents';
import { HttpClient, type HttpClientConfig } from './http-client';
// Simple inline type checking instead of external type guards

export interface SimpleRemoteConfig {
    serverUrl: string;
    userApiKey: string;
    timeout?: number;
    headers?: Record<string, string>;
    /** Enable WebSocket for real-time communication */
    enableWebSocket?: boolean;
    /** WebSocket endpoint path (defaults to /ws/playground) */
    websocketPath?: string;
    /** Auto-reconnect WebSocket on disconnect */
    autoReconnect?: boolean;
    /** Logger instance for dependency injection */
    logger?: SimpleLogger;
}

export interface SimpleExecutionRequest {
    messages: BasicMessage[];
    provider: string;
    model: string;
}

/**
 * Simple RemoteExecutor using atomic components
 * Implements ExecutorInterface for full compatibility with LocalExecutor
 */
export class SimpleRemoteExecutor implements ExecutorInterface {
    readonly name = 'remote';
    readonly version = '1.0.0';

    private readonly httpClient: HttpClient;
    private readonly logger: SimpleLogger;
    private readonly config: SimpleRemoteConfig;

    constructor(config: SimpleRemoteConfig) {
        this.config = config;
        // Validate configuration
        this.validateConfig();

        // Initialize logger with dependency injection pattern
        this.logger = config.logger || SilentLogger;

        // Create HTTP client with timeout and headers
        const httpConfig: HttpClientConfig = {
            baseUrl: config.serverUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.userApiKey}`,
                ...config.headers
            },
            logger: this.logger
        };

        this.httpClient = new HttpClient(httpConfig);
    }

    /**
     * Execute chat request (ExecutorInterface compatible)
     */
    async executeChat(request: ChatExecutionRequest): Promise<AssistantMessage> {
        this.logger.debug('SimpleRemoteExecutor.executeChat called', {
            hasTools: !!request.tools,
            toolsCount: request.tools?.length || 0
        });

        this.logger.debug('Using ExecutorInterface format (non-streaming)');
        const messages = request.messages;
        const provider = request.provider;
        const model = request.model;

        const response = await this.httpClient.chat(messages, provider, model, request.tools);

        // Convert ResponseMessage to AssistantMessage (ExecutorInterface requirement)
        const assistantMessage: AssistantMessage = {
            role: 'assistant',
            content: response.content || '',
            timestamp: new Date()
        };

        if (response.toolCalls) {
            assistantMessage.toolCalls = response.toolCalls;
        }

        return assistantMessage;
    }

    /**
     * Execute streaming chat request (ExecutorInterface compatible)
     */
    async *executeChatStream(request: StreamExecutionRequest): AsyncIterable<UniversalMessage> {
        this.logger.debug('SimpleRemoteExecutor.executeChatStream called', {
            hasTools: !!request.tools,
            toolsCount: request.tools?.length || 0
        });

        this.logger.debug('Using ExecutorInterface format (streaming)');
        const messages = request.messages;
        const provider = request.provider;
        const model = request.model;
        const tools = request.tools;

        // ✅ LocalExecutor와 동일한 tool call 병합 로직 구현
        let toolCalls: ToolCall[] = [];
        let currentToolCallIndex = -1; // 현재 작업중인 도구 호출 인덱스

        for await (const response of this.httpClient.chatStream(messages, provider, model, tools)) {
            // Convert ResponseMessage to UniversalMessage (preserving toolCalls)
            const universalMessage: UniversalMessage = {
                role: response.role as 'assistant',
                content: response.content,
                timestamp: new Date(),
                ...(response.toolCalls && { toolCalls: response.toolCalls })
            };

            // ✅ ExecutionService와 동일한 tool call 병합 로직
            if (universalMessage.role === 'assistant') {
                const assistantChunk = universalMessage as any; // Type assertion to handle toolCalls
                if (assistantChunk.toolCalls && assistantChunk.toolCalls.length > 0) {
                    // 스트림 도구 호출 상태 관리
                    for (const chunkToolCall of assistantChunk.toolCalls) {
                        if (chunkToolCall.id && chunkToolCall.id !== '') {
                            // ✅ ID 있음 = 새 도구 호출 시작
                            currentToolCallIndex = toolCalls.length;
                            toolCalls.push({
                                id: chunkToolCall.id,
                                type: chunkToolCall.type || 'function',
                                function: {
                                    name: chunkToolCall.function?.name || '',
                                    arguments: chunkToolCall.function?.arguments || ''
                                }
                            });
                            this.logger.debug(`New tool call started: ${chunkToolCall.id} (${chunkToolCall.function?.name})`);
                        } else if (currentToolCallIndex >= 0) {
                            // ✅ ID 없음 = 현재 도구 호출에 조각 추가
                            if (chunkToolCall.function?.name) {
                                toolCalls[currentToolCallIndex].function.name += chunkToolCall.function.name;
                            }
                            if (chunkToolCall.function?.arguments) {
                                toolCalls[currentToolCallIndex].function.arguments += chunkToolCall.function.arguments;
                            }
                            this.logger.debug(`Adding fragment to tool ${toolCalls[currentToolCallIndex].id}: "${chunkToolCall.function?.arguments || chunkToolCall.function?.name || ''}"`);
                        }
                    }

                    // ✅ 병합된 tool call이 있는 경우 새로운 청크로 교체
                    if (toolCalls.length > 0) {
                        // content만 있는 청크는 그대로 yield (UI 표시용)
                        if (universalMessage.content && universalMessage.content.trim() !== '') {
                            yield {
                                role: 'assistant',
                                content: universalMessage.content,
                                timestamp: new Date()
                            };
                        }
                        continue; // tool call 청크는 개별적으로 yield하지 않음
                    }
                }
            }

            // ✅ content가 있는 청크는 그대로 yield (UI 표시용)
            if (universalMessage.content && universalMessage.content.trim() !== '') {
                yield universalMessage;
            }
        }

        // ✅ 스트림 완료 시 완전한 tool call들을 포함한 최종 메시지 yield
        if (toolCalls.length > 0) {
            this.logger.debug('Stream completed, yielding complete tool calls:', toolCalls.length);
            yield {
                role: 'assistant',
                content: '', // tool call 전용 메시지
                timestamp: new Date(),
                toolCalls: toolCalls
            };
        }
    }

    /**
     * Check if the executor supports tool calling (ExecutorInterface requirement)
     */
    supportsTools(): boolean {
        return true;
    }

    /**
     * Validate executor configuration (ExecutorInterface requirement)
     */
    validateConfig(): boolean {
        if (!this.config.serverUrl) {
            throw new Error('BaseURL is required but not provided');
        }
        if (!this.config.userApiKey) {
            throw new Error('User API key is required but not provided');
        }
        return true;
    }

    /**
     * Clean up resources (ExecutorInterface requirement)
     */
    async dispose(): Promise<void> {
        // Cleanup any resources if needed
        this.logger.debug('SimpleRemoteExecutor disposed');
    }
} 