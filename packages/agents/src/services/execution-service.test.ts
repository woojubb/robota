import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionService } from './execution-service';
import { ConversationHistory } from '../managers/conversation-history-manager';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { BaseAIProvider } from '../abstracts/base-ai-provider';
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
class MockAIProvider extends BaseAIProvider {
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

// Define mock session value type
type MockSessionValue = {
    getMessages: () => any[];
    getMessageCount: () => number;
    addUserMessage: (content: string, metadata?: any) => void;
    addAssistantMessage: (content: string, metadata?: any) => void;
    addSystemMessage: (content: string) => void;
    addToolMessageWithId: (content: string, toolCallId: string, toolName: string, metadata?: any) => void;
    addMessage: (message: any) => void;
    clear: () => void;
    getMessagesByRole: (role: string) => any[];
    getRecentMessages: (count: number) => any[];
} | null;

// Create a mock class that extends ConversationHistory
class MockConversationHistory extends ConversationHistory {
    private mockSession: Record<string, MockSessionValue>;

    constructor() {
        super({ maxMessagesPerConversation: 100, maxConversations: 10 });
        this.mockSession = {};
    }

    override getConversationSession(conversationId: string): MockSessionValue {
        return this.mockSession[conversationId] || null;
    }

    setMockSession(session: Record<string, MockSessionValue>): void {
        this.mockSession = session;
    }
}

// Create mock classes using interface implementation instead of inheritance

describe('ExecutionService', () => {
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

        // Create mock AI providers manager with interface methods
        aiProviders = {
            getCurrentProviderInstance: vi.fn().mockReturnValue(mockProvider),
            getCurrentProvider: vi.fn().mockReturnValue({ provider: 'mock-provider', model: 'mock-model' }),
            getProviderInstance: vi.fn().mockReturnValue(mockProvider),
            getAvailableProviders: vi.fn().mockReturnValue(['mock-provider']),
            initialize: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            isInitialized: vi.fn().mockReturnValue(true),
            addProvider: vi.fn(),
            removeProvider: vi.fn(),
            getProvider: vi.fn().mockReturnValue(mockProvider),
            getProviders: vi.fn().mockReturnValue({ 'mock-provider': mockProvider }),
            setCurrentProvider: vi.fn(),
            isConfigured: vi.fn().mockReturnValue(true),
            getAvailableModels: vi.fn().mockReturnValue(['mock-model']),
            getProviderNames: vi.fn().mockReturnValue(['mock-provider']),
            getProvidersByPattern: vi.fn().mockReturnValue({ 'mock-provider': mockProvider }),
            supportsStreaming: vi.fn().mockReturnValue(true),
            getProviderCount: vi.fn().mockReturnValue(1)
        };

        // Create mock tools manager with interface methods
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
            hasTool: vi.fn().mockReturnValue(true),
            getRegisteredToolNames: vi.fn().mockReturnValue(['testTool']),
            getToolsForExecution: vi.fn().mockReturnValue([]),
            initialize: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
            isInitialized: vi.fn().mockReturnValue(true),
            addTool: vi.fn(),
            removeTool: vi.fn(),
            getTool: vi.fn(),
            getToolSchema: vi.fn(),
            executeTool: vi.fn(),
            setAllowedTools: vi.fn(),
            getAllowedTools: vi.fn(),
            getRegistry: vi.fn(),
            getToolCount: vi.fn().mockReturnValue(1)
        };

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
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent',
                systemMessage: 'You are a helpful assistant.'
            };

            // Create and set mock session
            const mockSession = {
                getMessages: vi.fn(),
                getMessageCount: vi.fn(),
                addUserMessage: vi.fn(),
                addAssistantMessage: vi.fn(),
                addSystemMessage: vi.fn(),
                addToolMessageWithId: vi.fn(),
                addMessage: vi.fn(),
                clear: vi.fn(),
                getMessagesByRole: vi.fn(),
                getRecentMessages: vi.fn()
            };
            conversationHistory.setMockSession({ 'test-conversation': mockSession });

            // Mock conversation session messages with assistant response
            mockSession.getMessages = vi.fn()
                .mockReturnValueOnce([]) // first call (empty)
                .mockReturnValue([
                    { role: 'user', content: input, timestamp: new Date() },
                    { role: 'assistant', content: 'Mock response', timestamp: new Date() }
                ]);

            const result = await executionService.execute(input, messages, config);

            expect(result.success).toBe(true);
            expect(result.response).toBe('Mock response');
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

            // Create and set mock session for tool calls test
            const mockToolSession = {
                getMessages: vi.fn(),
                getMessageCount: vi.fn(),
                addUserMessage: vi.fn(),
                addAssistantMessage: vi.fn(),
                addSystemMessage: vi.fn(),
                addToolMessageWithId: vi.fn(),
                addMessage: vi.fn(),
                clear: vi.fn(),
                getMessagesByRole: vi.fn(),
                getRecentMessages: vi.fn()
            };
            conversationHistory.setMockSession({ 'test-conversation': mockToolSession });

            // Mock conversation session messages progression
            mockToolSession.getMessages = vi.fn()
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
            const messages: Message[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            const result = await executionService.execute(input, messages, config);

            expect(result.success).toBe(true);
            expect(result.response).toBe('Task completed with tool result');

            // Verify conversation history updates
            expect(mockToolSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
            expect(mockToolSession.addAssistantMessage).toHaveBeenCalledTimes(2);
            expect(mockToolSession.addToolMessageWithId).toHaveBeenCalledTimes(1);
        });

        it('should handle errors during execution', async () => {
            mockProvider.chat = vi.fn().mockRejectedValue(new Error('Provider error'));

            const input = 'Hello';
            const messages: Message[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            await expect(executionService.execute(input, messages, config)).rejects.toThrow('Provider error');
        });

        it('should initialize conversation history with existing messages', async () => {
            const input = 'Hello again';
            const messages: Message[] = [
                { role: 'user', content: 'Hello', timestamp: new Date() },
                { role: 'assistant', content: 'Hi there!', timestamp: new Date() }
            ] as Message[];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            // Mock empty conversation history
            const mockSession = conversationHistory.getConversationSession('test-conversation');
            mockSession.getMessageCount = vi.fn().mockReturnValue(0);

            await executionService.execute(input, messages, config);

            // Verify all messages were added
            expect(mockSession.addUserMessage).toHaveBeenCalledWith('Hello', undefined);
            expect(mockSession.addAssistantMessage).toHaveBeenCalledWith('Hi there!', undefined, undefined);
            expect(mockSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
        });

        it('should handle messages with system role', async () => {
            const input = 'Hello';
            const messages: Message[] = [
                { role: 'system', content: 'You are a helpful assistant', timestamp: new Date() },
                { role: 'user', content: 'Previous question', timestamp: new Date() }
            ] as Message[];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            // Mock empty conversation history
            const mockSession = conversationHistory.getConversationSession('test-conversation');
            mockSession.getMessageCount = vi.fn().mockReturnValue(0);

            await executionService.execute(input, messages, config);

            // Verify system message was added
            expect(mockSession.addSystemMessage).toHaveBeenCalledWith('You are a helpful assistant', undefined);
            expect(mockSession.addUserMessage).toHaveBeenCalledWith('Previous question', undefined);
            expect(mockSession.addUserMessage).toHaveBeenCalledWith(input, expect.any(Object));
        });

        it('should handle no AI provider available', async () => {
            // Mock no provider available
            aiProviders.getCurrentProviderInstance = vi.fn().mockReturnValue(null);

            const input = 'Hello';
            const messages: Message[] = [];
            const config: AgentConfig = {
                model: 'gpt-4',
                provider: 'openai',
                name: 'test-agent'
            };

            await expect(executionService.execute(input, messages, config)).rejects.toThrow('No AI provider available');
        });
    });
}); 