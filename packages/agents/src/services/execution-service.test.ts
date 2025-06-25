import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionService } from './execution-service';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
import type { UniversalMessage } from '../managers/conversation-history-manager';
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

// Create a mock class that extends BaseAIProvider
class MockAIProvider extends BaseAIProvider {
    chat = vi.fn().mockResolvedValue({
        content: 'Mock response',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop'
    });

    chatStream = vi.fn();
    supportsTools = vi.fn().mockReturnValue(true);
    validateConfig = vi.fn().mockReturnValue(true);
    dispose = vi.fn();
}

describe('ExecutionService', () => {
    let executionService: ExecutionService;
    let conversationHistory: ConversationHistory;
    let aiProviders: AIProviders;
    let tools: Tools;
    let mockProvider: MockAIProvider;
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
            hasConversation: vi.fn(),
            removeConversation: vi.fn(),
            clearAll: vi.fn(),
            getStats: vi.fn().mockReturnValue({
                totalConversations: 0,
                conversationIds: [],
                totalMessages: 0
            })
        } as unknown as ConversationHistory;

        // Create mock AI provider that extends BaseAIProvider
        mockProvider = new MockAIProvider();

        // Create mock AI providers manager
        aiProviders = {
            getCurrentProviderInstance: vi.fn().mockReturnValue(mockProvider),
            getCurrentProvider: vi.fn().mockReturnValue('openai'),
            getProviderInstance: vi.fn().mockReturnValue(mockProvider),
            switchProvider: vi.fn(),
            getAvailableProviders: vi.fn().mockReturnValue(['openai']),
            dispose: vi.fn()
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
            ]),
            registerTool: vi.fn(),
            unregisterTool: vi.fn(),
            clearTools: vi.fn(),
            hasTools: vi.fn().mockReturnValue(true),
            getRegisteredToolNames: vi.fn().mockReturnValue(['testTool']),
            getToolsForExecution: vi.fn().mockReturnValue([]),
            filterTools: vi.fn(),
            dispose: vi.fn()
        } as unknown as Tools;

        // Create execution service
        executionService = new ExecutionService(
            aiProviders,
            tools,
            conversationHistory
        );
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('execute', () => {
        it('should execute a conversation without tool calls', async () => {
            const input = 'Hello, how are you?';
            const messages: UniversalMessage[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent',
                systemMessage: 'You are a helpful assistant.'
            };

            // Mock conversation session messages with assistant response
            conversationSession.getMessages = vi.fn()
                .mockReturnValueOnce([]) // first call (empty)
                .mockReturnValue([
                    { role: 'user', content: input, timestamp: new Date() },
                    { role: 'assistant', content: 'Mock response', timestamp: new Date() }
                ]);

            const result = await executionService.execute(input, messages, config);

            expect(result.success).toBe(true);
            expect(result.response).toBe('Mock response');
            expect(mockProvider.chat).toHaveBeenCalledTimes(1);
            expect(conversationHistory.getConversationSession).toHaveBeenCalled();
        });

        it('should execute a conversation with tool calls', async () => {
            // Mock provider to return tool calls
            mockProvider.chat = vi.fn()
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

            // Mock tool execution service in ExecutionService
            const mockToolExecutionService = {
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
            };

            // Replace the tool execution service in the execution service
            (executionService as any).toolExecutionService = mockToolExecutionService;

            // Mock conversation session messages progression
            conversationSession.getMessages = vi.fn()
                .mockReturnValueOnce([]) // first call (empty)
                .mockReturnValueOnce([  // after first AI response
                    { role: 'user', content: 'Use a tool to do something', timestamp: new Date() },
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
                    }
                ])
                .mockReturnValue([  // final messages
                    { role: 'user', content: 'Use a tool to do something', timestamp: new Date() },
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
                    {
                        role: 'tool',
                        content: JSON.stringify({ result: 'success' }),
                        toolCallId: 'tool-1',
                        name: 'testTool',
                        timestamp: new Date()
                    },
                    {
                        role: 'assistant',
                        content: 'Task completed with tool result',
                        timestamp: new Date()
                    }
                ]);

            const input = 'Use a tool to do something';
            const messages: UniversalMessage[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            const result = await executionService.execute(input, messages, config);

            expect(result.success).toBe(true);
            expect(result.response).toBe('Task completed with tool result');
            expect(mockProvider.chat).toHaveBeenCalledTimes(2);
            expect(mockToolExecutionService.createExecutionRequests).toHaveBeenCalledTimes(1);
            expect(mockToolExecutionService.executeTools).toHaveBeenCalledTimes(1);

            // Verify conversation history updates
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
            expect(conversationSession.addAssistantMessage).toHaveBeenCalledTimes(2);
            expect(conversationSession.addToolMessageWithId).toHaveBeenCalledTimes(1);
        });

        it('should handle errors during execution', async () => {
            mockProvider.chat = vi.fn().mockRejectedValue(new Error('Provider error'));

            const input = 'Hello';
            const messages: UniversalMessage[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            await expect(executionService.execute(input, messages, config)).rejects.toThrow('Provider error');
        });

        it('should initialize conversation history with existing messages', async () => {
            const input = 'Hello again';
            const messages: UniversalMessage[] = [
                { role: 'user', content: 'Hello', timestamp: new Date() },
                { role: 'assistant', content: 'Hi there!', timestamp: new Date() }
            ];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            // Mock empty conversation history
            (conversationSession.getMessageCount as any).mockReturnValue(0);

            await executionService.execute(input, messages, config);

            // Verify all messages were added
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith('Hello', undefined);
            expect(conversationSession.addAssistantMessage).toHaveBeenCalledWith('Hi there!', undefined, undefined);
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
        });

        it('should handle messages with system role', async () => {
            const input = 'Hello';
            const messages: UniversalMessage[] = [
                { role: 'system', content: 'You are a helpful assistant', timestamp: new Date() },
                { role: 'user', content: 'Previous question', timestamp: new Date() }
            ];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            // Mock empty conversation history
            (conversationSession.getMessageCount as any).mockReturnValue(0);

            await executionService.execute(input, messages, config);

            // Verify system message was added
            expect(conversationSession.addSystemMessage).toHaveBeenCalledWith('You are a helpful assistant', undefined);
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith('Previous question', undefined);
            expect(conversationSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
        });

        it('should handle no AI provider available', async () => {
            // Mock no provider available
            aiProviders.getCurrentProviderInstance = vi.fn().mockReturnValue(null);

            const input = 'Hello';
            const messages: UniversalMessage[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            await expect(executionService.execute(input, messages, config)).rejects.toThrow('No AI provider available');
        });
    });
}); 