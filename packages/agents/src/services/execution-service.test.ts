import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionService } from './execution-service';
import { ConversationHistoryManager } from '../managers/conversation-history-manager';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { Plugins } from '../managers/plugin-manager';
import { ToolExecutionService } from './tool-execution-service';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import type { Message } from '../interfaces/agent';
import type { ProviderExecutionResult } from '../interfaces/provider';
import type { AgentConfig } from '../interfaces/agent';

// Mock dependencies
vi.mock('../utils/logger', () => ({
    Logger: vi.fn().mockImplementation(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }))
}));

vi.mock('./tool-execution-service', () => ({
    ToolExecutionService: vi.fn().mockImplementation(() => ({
        createExecutionRequests: vi.fn().mockReturnValue([
            { toolName: 'testTool', parameters: { param: 'value' }, executionId: 'tool-1' }
        ]),
        executeTools: vi.fn().mockResolvedValue({
            totalExecuted: 1,
            successful: 1,
            failed: 0,
            totalDuration: 100,
            averageDuration: 100,
            results: [
                {
                    success: true,
                    toolName: 'testTool',
                    result: JSON.stringify({ result: 'success' }),
                    executionId: 'tool-1',
                    duration: 100
                }
            ],
            errors: []
        })
    }))
}));

describe('ExecutionService', () => {
    let executionService: ExecutionService;
    let conversationHistory: ConversationHistoryManager;
    let aiProviders: AIProviders;
    let tools: Tools;
    let plugins: Plugins;
    let toolExecutionService: ToolExecutionService;
    let mockProvider: BaseAIProvider;
    let conversationSession: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock conversation session
        conversationSession = {
            getMessages: vi.fn().mockReturnValue([]),
            getMessageCount: vi.fn().mockReturnValue(0),
            addUserMessage: vi.fn(),
            addAssistantMessage: vi.fn(),
            addSystemMessage: vi.fn(),
            addToolMessageWithId: vi.fn(),
            addMessage: vi.fn()
        };

        // Create mock conversation history
        conversationHistory = {
            getConversationSession: vi.fn().mockReturnValue(conversationSession),
            createConversationSession: vi.fn(),
            getStats: vi.fn().mockReturnValue({})
        } as unknown as ConversationHistoryManager;

        // Create mock AI provider
        mockProvider = {
            execute: vi.fn().mockResolvedValue({
                content: 'Mock response',
                toolCalls: [],
                usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                finishReason: 'stop'
            })
        } as unknown as BaseAIProvider;

        // Create mock AI providers manager
        aiProviders = {
            getCurrentProviderInstance: vi.fn().mockReturnValue(mockProvider)
        } as unknown as AIProviders;

        // Create mock tools manager
        tools = {
            getTools: vi.fn().mockReturnValue([
                {
                    type: 'function',
                    function: {
                        name: 'testTool',
                        description: 'A test tool',
                        parameters: {
                            type: 'object',
                            properties: {
                                param: { type: 'string' }
                            },
                            required: ['param']
                        }
                    }
                }
            ])
        } as unknown as Tools;

        // Create mock plugins manager
        plugins = {
            callHook: vi.fn().mockResolvedValue(undefined)
        } as unknown as Plugins;

        // Create mock tool execution service
        toolExecutionService = new ToolExecutionService(tools);

        // Create execution service
        executionService = new ExecutionService(
            conversationHistory,
            aiProviders,
            tools,
            plugins,
            toolExecutionService
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('should execute a conversation without tool calls', async () => {
            const input = 'Hello, how are you?';
            const messages: Message[] = [];
            const config = { model: 'gpt-4', systemMessage: 'You are a helpful assistant.' };

            const result = await executionService.execute(input, messages, config);

            expect(result.success).toBe(true);
            expect(result.response).toBe('Mock response');
            expect(mockProvider.execute).toHaveBeenCalledTimes(1);
            expect(conversationHistory.getConversationSession).toHaveBeenCalled();
        });

        it('should execute a conversation with tool calls', async () => {
            // Mock provider to return tool calls
            mockProvider.execute = vi.fn()
                .mockResolvedValueOnce({
                    content: 'I need to use a tool',
                    toolCalls: [
                        {
                            id: 'tool-1',
                            type: 'function',
                            function: {
                                name: 'testTool',
                                arguments: JSON.stringify({ param: 'value' })
                            }
                        }
                    ],
                    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                    finishReason: 'tool_calls'
                })
                .mockResolvedValueOnce({
                    content: 'Task completed with tool result',
                    toolCalls: [],
                    usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
                    finishReason: 'stop'
                });

            const input = 'Use a tool to do something';
            const messages: Message[] = [];
            const config = { model: 'gpt-4' };

            const result = await executionService.execute(input, messages, config);

            expect(result.success).toBe(true);
            expect(result.response).toBe('Task completed with tool result');
            expect(mockProvider.execute).toHaveBeenCalledTimes(2);
            expect(toolExecutionService.createExecutionRequests).toHaveBeenCalledTimes(1);
            expect(toolExecutionService.executeTools).toHaveBeenCalledTimes(1);

            // Verify conversation history updates
            const conversationSession = conversationHistory.getConversationSession();
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
            expect(conversationSession.addAssistantMessage).toHaveBeenCalledTimes(2);
            expect(conversationSession.addToolMessageWithId).toHaveBeenCalledTimes(1);
        });

        it('should handle errors during execution', async () => {
            mockProvider.execute = vi.fn().mockRejectedValue(new Error('Provider error'));

            const input = 'Hello';
            const messages: Message[] = [];
            const config = { model: 'gpt-4' };

            await expect(executionService.execute(input, messages, config)).rejects.toThrow('Provider error');
            expect(plugins.callHook).toHaveBeenCalledWith('onError', expect.any(Error), expect.any(Object));
        });

        it('should initialize conversation history with existing messages', async () => {
            const input = 'Hello again';
            const messages: Message[] = [
                { role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
                { role: 'assistant', content: 'Hi there!', timestamp: new Date().toISOString() }
            ];
            const config = { model: 'gpt-4' };

            // Mock empty conversation history
            const conversationSession = conversationHistory.getConversationSession();
            (conversationSession.getMessageCount as any).mockReturnValue(0);

            await executionService.execute(input, messages, config);

            // Verify all messages were added
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith('Hello', undefined);
            expect(conversationSession.addAssistantMessage).toHaveBeenCalledWith('Hi there!', undefined, undefined);
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
        });
    });

    describe('도구 실행 결과 처리', () => {
        it('should prevent duplicate tool results in conversation history', async () => {
            // 1. 도구 호출이 포함된 응답을 반환하도록 AI 제공자 설정
            mockProvider.execute = vi.fn()
                .mockResolvedValueOnce({
                    content: 'I need to use a tool',
                    toolCalls: [
                        {
                            id: 'tool-1',
                            type: 'function',
                            function: {
                                name: 'testTool',
                                arguments: JSON.stringify({ param: 'value' })
                            }
                        }
                    ],
                    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                    finishReason: 'tool_calls'
                })
                .mockResolvedValueOnce({
                    content: 'Task completed with tool result',
                    toolCalls: [],
                    usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
                    finishReason: 'stop'
                });

            // 2. 기존 대화 메시지에 이미 동일한 도구 결과가 있다고 가정
            conversationSession.getMessages = vi.fn().mockReturnValue([
                { role: 'user', content: 'Use a tool', timestamp: new Date() },
                {
                    role: 'assistant',
                    content: 'I need to use a tool',
                    toolCalls: [
                        {
                            id: 'tool-1',
                            type: 'function',
                            function: { name: 'testTool', arguments: JSON.stringify({ param: 'value' }) }
                        }
                    ],
                    timestamp: new Date()
                },
                // 이미 존재하는 도구 결과 메시지
                {
                    role: 'tool',
                    content: JSON.stringify({ result: 'success' }),
                    toolCallId: 'tool-1',
                    timestamp: new Date()
                }
            ]);

            // 3. 실행 서비스 실행
            const input = 'Use a tool again';
            const messages: Message[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test'
            };

            await executionService.execute(input, messages, config);

            // 4. 도구 결과가 중복으로 추가되지 않았는지 확인
            expect(conversationSession.addToolMessageWithId).not.toHaveBeenCalled();
        });

        it('should add tool results to conversation history when not duplicated', async () => {
            // 1. 도구 호출이 포함된 응답을 반환하도록 AI 제공자 설정
            mockProvider.execute = vi.fn()
                .mockResolvedValueOnce({
                    content: 'I need to use a tool',
                    toolCalls: [
                        {
                            id: 'tool-2',
                            type: 'function',
                            function: {
                                name: 'testTool',
                                arguments: JSON.stringify({ param: 'value' })
                            }
                        }
                    ],
                    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
                    finishReason: 'tool_calls'
                })
                .mockResolvedValueOnce({
                    content: 'Task completed with tool result',
                    toolCalls: [],
                    usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
                    finishReason: 'stop'
                });

            // 2. 기존 대화 메시지에 해당 도구 결과가 없다고 가정
            conversationSession.getMessages = vi.fn().mockReturnValue([
                { role: 'user', content: 'Use a tool', timestamp: new Date() }
            ]);

            // 3. 실행 서비스 실행
            const input = 'Use a tool';
            const messages: Message[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test'
            };

            await executionService.execute(input, messages, config);

            // 4. 도구 결과가 추가되었는지 확인
            expect(conversationSession.addToolMessageWithId).toHaveBeenCalledWith(
                expect.any(String),
                'tool-2',
                'testTool',
                expect.any(Object)
            );
        });
    });
}); 