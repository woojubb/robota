import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionService } from './execution-service';
import { ConversationHistory, ConversationSession } from '../managers/conversation-history-manager';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AbstractAIProvider } from '../abstracts/abstract-ai-provider';
import type { UniversalMessage } from '../managers/conversation-history-manager';
import type { AgentConfig, Message } from '../interfaces/agent';
import type { ChatOptions } from '../interfaces/provider';

// Mock dependencies
vi.mock('../utils/logger', () => ({
    Logger: vi.fn().mockImplementation(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    })),
    createLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isDebugEnabled: vi.fn().mockReturnValue(false),
        setLevel: vi.fn(),
        getLevel: vi.fn().mockReturnValue('warn')
    })
}));

// Create a mock class that extends BaseAIProvider
class MockAIProvider extends AbstractAIProvider {
    readonly name = 'mock-provider';
    readonly version = '1.0.0';

    async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
        return {
            role: 'assistant',
            content: 'Mock response',
            timestamp: new Date()
        };
    }

    async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
        yield {
            role: 'assistant',
            content: 'Mock response',
            timestamp: new Date()
        };
    }
}

// Create a mock class that extends ConversationHistory
class MockConversationHistory extends ConversationHistory {
    private sessions = new Map<string, ConversationSession>();

    constructor() {
        super({ maxMessagesPerConversation: 100, maxConversations: 10 });
    }

    override getConversationSession(conversationId: string): ConversationSession {
        const existing = this.sessions.get(conversationId);
        if (existing) return existing;

        const session = super.getConversationSession(conversationId);
        this.sessions.set(conversationId, session);
        return session;
    }
}

// Create mock classes using interface implementation instead of inheritance

describe.skip('ExecutionService', () => {
    let executionService: ExecutionService;
    let conversationHistory: MockConversationHistory;
    let aiProviders: AIProviders;
    let tools: Tools;
    let mockProvider: MockAIProvider;

    beforeEach(() => {
        vi.clearAllMocks();

        // Create mock AI provider that extends BaseAIProvider
        mockProvider = new MockAIProvider();

        // Create mock conversation history that extends ConversationHistory
        conversationHistory = new MockConversationHistory();

        // Use real manager instances (type-safe) and stub behavior as needed.
        aiProviders = new AIProviders();
        // Tests are skipped; stubs exist purely to satisfy typecheck.
        vi.spyOn(aiProviders, 'getCurrentProviderInstance').mockReturnValue(mockProvider);
        vi.spyOn(aiProviders, 'getCurrentProvider').mockReturnValue({ provider: 'mock-provider', model: 'mock-model' });
        vi.spyOn(aiProviders, 'isConfigured').mockReturnValue(true);
        vi.spyOn(aiProviders, 'getProvider').mockReturnValue(mockProvider);
        vi.spyOn(aiProviders, 'getProviders').mockReturnValue({ 'mock-provider': mockProvider });
        vi.spyOn(aiProviders, 'getProviderNames').mockReturnValue(['mock-provider']);
        vi.spyOn(aiProviders, 'supportsStreaming').mockReturnValue(true);
        vi.spyOn(aiProviders, 'getProviderCount').mockReturnValue(1);

        // Create mock tools manager with interface methods
        tools = new Tools();
        vi.spyOn(tools, 'getTools').mockReturnValue([
            {
                name: 'testTool',
                description: 'A test tool',
                parameters: {
                    type: 'object',
                    properties: {
                        param: { type: 'string', description: 'param' }
                    },
                    required: ['param']
                }
            }
        ]);
        vi.spyOn(tools, 'hasTool').mockReturnValue(true);
        vi.spyOn(tools, 'getToolCount').mockReturnValue(1);

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
            const messages: Message[] = [];
            const config: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4',
                    systemMessage: 'You are a helpful assistant.'
                }
            };

            const session = conversationHistory.getConversationSession('test-agent');
            const getMessagesSpy = vi.spyOn(session, 'getMessages');
            getMessagesSpy
                .mockReturnValueOnce([]) // first call (empty)
                .mockReturnValue([
                    { role: 'user', content: input, timestamp: new Date() },
                    { role: 'assistant', content: 'Mock response', timestamp: new Date() }
                ]);

            const result = await executionService.execute(input, messages, config, { conversationId: 'test-agent' });

            expect(result.success).toBe(true);
            expect(result.response).toBe('Mock response');
        });

        it('should execute a conversation with tool calls', async () => {
            const toolInput = 'Use the test tool';
            const toolMessages: Message[] = [];
            const toolConfig: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4',
                    systemMessage: 'You are a helpful assistant.'
                }
            };

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

            const session = conversationHistory.getConversationSession('test-agent');
            const addUserMessageSpy = vi.spyOn(session, 'addUserMessage');
            const addAssistantMessageSpy = vi.spyOn(session, 'addAssistantMessage');
            const addToolMessageWithIdSpy = vi.spyOn(session, 'addToolMessageWithId');
            const getMessagesSpy = vi.spyOn(session, 'getMessages');

            // Mock conversation session messages progression
            getMessagesSpy
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

            const testInput = 'Use a tool to do something';
            const testMessages: Message[] = [];
            const testConfig: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4'
                }
            };

            const result = await executionService.execute(testInput, testMessages, testConfig, { conversationId: 'test-agent' });

            expect(result.success).toBe(true);
            expect(result.response).toBe('Task completed with tool result');

            // Verify conversation history updates
            expect(addUserMessageSpy).toHaveBeenCalledWith(testInput, expect.any(Object));
            expect(addAssistantMessageSpy).toHaveBeenCalledTimes(2);
            expect(addToolMessageWithIdSpy).toHaveBeenCalledTimes(1);
        });

        it('should handle errors during execution', async () => {
            const errorInput = 'Hello';
            const errorMessages: Message[] = [];
            const errorConfig: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4'
                }
            };

            conversationHistory.getConversationSession('test-agent');

            mockProvider.chat = vi.fn().mockRejectedValue(new Error('Provider error'));

            await expect(executionService.execute(errorInput, errorMessages, errorConfig, { conversationId: 'test-agent' })).rejects.toThrow('Provider error');
        });

        it('should initialize conversation history with existing messages', async () => {
            const inputMsg = 'Hello again';
            const messagesArray: Message[] = [
                { role: 'user', content: 'Hello', timestamp: new Date() },
                { role: 'assistant', content: 'Hi there!', timestamp: new Date() }
            ] as Message[];
            const agentConfig: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4'
                }
            };

            const session = conversationHistory.getConversationSession('test-agent');
            const addUserMessageSpy = vi.spyOn(session, 'addUserMessage');
            const addAssistantMessageSpy = vi.spyOn(session, 'addAssistantMessage');

            await executionService.execute(inputMsg, messagesArray, agentConfig, { conversationId: 'test-agent' });

            // Verify all messages were added
            expect(addUserMessageSpy).toHaveBeenCalledWith('Hello', undefined);
            expect(addAssistantMessageSpy).toHaveBeenCalledWith('Hi there!', undefined, undefined);
            expect(addUserMessageSpy).toHaveBeenCalledWith(inputMsg, expect.any(Object));
        });

        it('should handle messages with system role', async () => {
            const userInput = 'Hello';
            const messagesList: Message[] = [
                { role: 'system', content: 'You are a helpful assistant', timestamp: new Date() },
                { role: 'user', content: 'Previous question', timestamp: new Date() }
            ] as Message[];
            const testConfig: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4'
                }
            };

            const session = conversationHistory.getConversationSession('test-agent');
            const addSystemMessageSpy = vi.spyOn(session, 'addSystemMessage');
            const addUserMessageSpy = vi.spyOn(session, 'addUserMessage');

            await executionService.execute(userInput, messagesList, testConfig, { conversationId: 'test-agent' });

            // Verify system message was added
            expect(addSystemMessageSpy).toHaveBeenCalledWith('You are a helpful assistant', undefined);
            expect(addUserMessageSpy).toHaveBeenCalledWith('Previous question', undefined);
            expect(addUserMessageSpy).toHaveBeenCalledWith(userInput, expect.any(Object));
        });

        it('should handle no AI provider available', async () => {
            const testInput = 'Hello';
            const emptyMessages: Message[] = [];
            const providerConfig: AgentConfig = {
                name: 'test-agent',
                aiProviders: [mockProvider],
                defaultModel: {
                    provider: 'openai',
                    model: 'gpt-4'
                }
            };

            conversationHistory.getConversationSession('test-agent');

            // Mock no provider available
            aiProviders.getCurrentProviderInstance = vi.fn().mockReturnValue(null);

            await expect(executionService.execute(testInput, emptyMessages, providerConfig, { conversationId: 'test-agent' })).rejects.toThrow('No AI provider available');
        });
    });
}); 