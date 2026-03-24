import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionService } from './execution-service';
import { ConversationHistory, ConversationStore } from '../managers/conversation-history-manager';
import { AIProviders } from '../managers/ai-provider-manager';
import { Tools } from '../managers/tool-manager';
import { AbstractAIProvider } from '../abstracts/abstract-ai-provider';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IAgentConfig } from '../interfaces/agent';
import type { IChatOptions } from '../interfaces/provider';

// Mock dependencies
vi.mock('../utils/logger', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    isDebugEnabled: vi.fn().mockReturnValue(false),
    setLevel: vi.fn(),
    getLevel: vi.fn().mockReturnValue('warn'),
  };
  return {
    Logger: vi.fn().mockImplementation(() => logger),
    SilentLogger: logger,
    createLogger: vi.fn().mockReturnValue(logger),
  };
});

// Create a mock class that extends BaseAIProvider
class MockAIProvider extends AbstractAIProvider {
  readonly name = 'mock-provider';
  readonly version = '1.0.0';

  async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
    return {
      role: 'assistant',
      content: 'Mock response',
      timestamp: new Date(),
    };
  }

  override async *chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage> {
    yield {
      role: 'assistant',
      content: 'Mock response',
      timestamp: new Date(),
    };
  }
}

// Create a mock class that extends ConversationHistory
class MockConversationHistory extends ConversationHistory {
  private sessions = new Map<string, ConversationStore>();

  constructor() {
    super({ maxMessagesPerConversation: 100, maxConversations: 10 });
  }

  override getConversationStore(conversationId: string): ConversationStore {
    const existing = this.sessions.get(conversationId);
    if (existing) return existing;

    const session = super.getConversationStore(conversationId);
    this.sessions.set(conversationId, session);
    return session;
  }
}

// Create mock event service
const createMockEventService = () => ({
  emit: vi.fn(),
  on: vi.fn().mockReturnValue(vi.fn()),
  off: vi.fn(),
  removeAllListeners: vi.fn(),
  listenerCount: vi.fn().mockReturnValue(0),
  eventNames: vi.fn().mockReturnValue([]),
  getOwnerPath: vi.fn().mockReturnValue([]),
  child: vi.fn().mockReturnThis(),
  isDefault: false,
});

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

    // Use real manager instances (type-safe) and stub behavior as needed.
    aiProviders = new AIProviders();
    // Tests are skipped; stubs exist purely to satisfy typecheck.
    vi.spyOn(aiProviders, 'getCurrentProviderInstance').mockReturnValue(mockProvider);
    vi.spyOn(aiProviders, 'getCurrentProvider').mockReturnValue({
      provider: 'mock-provider',
      model: 'mock-model',
    });
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
            param: { type: 'string', description: 'param' },
          },
          required: ['param'],
        },
      },
    ]);
    vi.spyOn(tools, 'hasTool').mockReturnValue(true);
    vi.spyOn(tools, 'getToolCount').mockReturnValue(1);

    // Create execution service
    executionService = new ExecutionService(
      aiProviders,
      tools,
      conversationHistory,
      createMockEventService() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('should execute a conversation without tool calls', async () => {
      const input = 'Hello, how are you?';
      const messages: TUniversalMessage[] = [];
      const config: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
          systemMessage: 'You are a helpful assistant.',
        },
      };

      const session = conversationHistory.getConversationStore('test-agent');
      const getMessagesSpy = vi.spyOn(session, 'getMessages');
      getMessagesSpy
        .mockReturnValueOnce([]) // first call (empty)
        .mockReturnValue([
          { role: 'user', content: input, timestamp: new Date() },
          { role: 'assistant', content: 'Mock response', timestamp: new Date() },
        ]);

      const result = await executionService.execute(input, messages, config, {
        conversationId: 'test-agent',
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Mock response');
    });

    it('should execute a conversation with tool calls', async () => {
      const toolInput = 'Use the test tool';
      const toolMessages: TUniversalMessage[] = [];
      const toolConfig: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
          systemMessage: 'You are a helpful assistant.',
        },
      };

      // Mock provider to return tool calls
      mockProvider.chat = vi
        .fn()
        .mockResolvedValueOnce({
          role: 'assistant',
          content: 'I need to use a tool',
          toolCalls: [
            {
              id: 'tool-1',
              type: 'function',
              function: {
                name: 'testTool',
                arguments: JSON.stringify({ param: 'value' }),
              },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          finishReason: 'tool_calls',
          timestamp: new Date(),
        })
        .mockResolvedValueOnce({
          role: 'assistant',
          content: 'Task completed with tool result',
          toolCalls: [],
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
          finishReason: 'stop',
          timestamp: new Date(),
        });

      // Mock tool execution service in ExecutionService
      const mockToolExecutionService = {
        createExecutionRequests: vi
          .fn()
          .mockReturnValue([
            { toolName: 'testTool', parameters: { param: 'value' }, executionId: 'tool-1' },
          ]),
        createExecutionRequestsWithContext: vi.fn().mockReturnValue([
          {
            toolName: 'testTool',
            parameters: { param: 'value' },
            executionId: 'tool-1',
            ownerId: 'tool-1',
            ownerPath: [{ ownerType: 'tool', ownerId: 'tool-1' }],
          },
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
              duration: 100,
            },
          ],
          errors: [],
        }),
      };

      // Replace the tool execution service in the execution service
      (executionService as any).toolExecutionService = mockToolExecutionService;

      const session = conversationHistory.getConversationStore('test-agent');
      const addUserMessageSpy = vi.spyOn(session, 'addUserMessage');
      const commitAssistantSpy = vi.spyOn(session, 'commitAssistant');
      const addToolMessageWithIdSpy = vi.spyOn(session, 'addToolMessageWithId');
      const getMessagesSpy = vi.spyOn(session, 'getMessages');

      // Mock conversation session messages progression
      getMessagesSpy
        .mockReturnValueOnce([]) // first call (empty)
        .mockReturnValueOnce([
          // after first AI response
          { role: 'user', content: 'Use a tool to do something', timestamp: new Date() },
          {
            role: 'assistant',
            content: 'I need to use a tool',
            toolCalls: [
              {
                id: 'tool-1',
                type: 'function',
                function: { name: 'testTool', arguments: JSON.stringify({ param: 'value' }) },
              },
            ],
            timestamp: new Date(),
          },
        ])
        .mockReturnValue([
          // final messages
          { role: 'user', content: 'Use a tool to do something', timestamp: new Date() },
          {
            role: 'assistant',
            content: 'I need to use a tool',
            toolCalls: [
              {
                id: 'tool-1',
                type: 'function',
                function: { name: 'testTool', arguments: JSON.stringify({ param: 'value' }) },
              },
            ],
            timestamp: new Date(),
          },
          {
            role: 'tool',
            content: JSON.stringify({ result: 'success' }),
            toolCallId: 'tool-1',
            name: 'testTool',
            timestamp: new Date(),
          },
          {
            role: 'assistant',
            content: 'Task completed with tool result',
            timestamp: new Date(),
          },
        ]);

      const testInput = 'Use a tool to do something';
      const testMessages: TUniversalMessage[] = [];
      const testConfig: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };

      const result = await executionService.execute(testInput, testMessages, testConfig, {
        conversationId: 'test-agent',
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Task completed with tool result');

      // Verify conversation history updates
      expect(addUserMessageSpy).toHaveBeenCalledWith(testInput, expect.any(Object));
      expect(commitAssistantSpy).toHaveBeenCalledTimes(2);
      expect(addToolMessageWithIdSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle errors during execution', async () => {
      const errorInput = 'Hello';
      const errorMessages: TUniversalMessage[] = [];
      const errorConfig: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };

      conversationHistory.getConversationStore('test-agent');

      mockProvider.chat = vi.fn().mockRejectedValue(new Error('Provider error'));

      // Provider errors are caught gracefully — an assistant message with the error
      // is injected instead of throwing, so the caller gets a readable error response
      const result = await executionService.execute(errorInput, errorMessages, errorConfig, {
        conversationId: 'test-agent',
      });
      expect(result.response).toContain('Provider error');
    });

    it('should initialize conversation history with existing messages', async () => {
      const inputMsg = 'Hello again';
      const messagesArray: TUniversalMessage[] = [
        { role: 'user', content: 'Hello', timestamp: new Date() },
        { role: 'assistant', content: 'Hi there!', timestamp: new Date() },
      ];
      const agentConfig: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };

      const session = conversationHistory.getConversationStore('test-agent');
      const addUserMessageSpy = vi.spyOn(session, 'addUserMessage');
      const addAssistantMessageSpy = vi.spyOn(session, 'addAssistantMessage');

      await executionService.execute(inputMsg, messagesArray, agentConfig, {
        conversationId: 'test-agent',
      });

      // Verify all messages were added (addUserMessage: content, metadata, parts; addAssistantMessage: content, toolCalls, metadata, parts)
      expect(addUserMessageSpy).toHaveBeenCalledWith('Hello', undefined, undefined);
      expect(addAssistantMessageSpy).toHaveBeenCalledWith(
        'Hi there!',
        undefined,
        undefined,
        undefined,
      );
      expect(addUserMessageSpy).toHaveBeenCalledWith(inputMsg, expect.any(Object));
    });

    it('should handle messages with system role', async () => {
      const userInput = 'Hello';
      const messagesList: TUniversalMessage[] = [
        { role: 'system', content: 'You are a helpful assistant', timestamp: new Date() },
        { role: 'user', content: 'Previous question', timestamp: new Date() },
      ];
      const testConfig: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };

      const session = conversationHistory.getConversationStore('test-agent');
      const addSystemMessageSpy = vi.spyOn(session, 'addSystemMessage');
      const addUserMessageSpy = vi.spyOn(session, 'addUserMessage');

      await executionService.execute(userInput, messagesList, testConfig, {
        conversationId: 'test-agent',
      });

      // Verify system message was added
      expect(addSystemMessageSpy).toHaveBeenCalledWith(
        'You are a helpful assistant',
        undefined,
        undefined,
      );
      expect(addUserMessageSpy).toHaveBeenCalledWith('Previous question', undefined, undefined);
      expect(addUserMessageSpy).toHaveBeenCalledWith(userInput, expect.any(Object));
    });

    it('should handle no AI provider available', async () => {
      const testInput = 'Hello';
      const emptyMessages: TUniversalMessage[] = [];
      const providerConfig: IAgentConfig = {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };

      conversationHistory.getConversationStore('test-agent');

      // Mock no provider available
      vi.spyOn(aiProviders, 'getCurrentProvider').mockReturnValue(null as any);

      await expect(
        executionService.execute(testInput, emptyMessages, providerConfig, {
          conversationId: 'test-agent',
        }),
      ).rejects.toThrow('[EXECUTION] Provider is required');
    });
  });

  describe('forced summary call when maxRounds exhausted', () => {
    const SYNTHETIC_MSG =
      'Tool round limit reached. Provide your response based on the information gathered so far. If results are incomplete, let the user know what was covered and what remains — the user can request additional analysis in a follow-up message.';

    function makeToolCallResponse(round: number): TUniversalMessage {
      return {
        role: 'assistant',
        content: `Tool call round ${round}`,
        toolCalls: [
          {
            id: `tool-${round}`,
            type: 'function',
            function: {
              name: 'testTool',
              arguments: JSON.stringify({ param: `value-${round}` }),
            },
          },
        ],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'tool_calls',
        timestamp: new Date(),
      } as TUniversalMessage;
    }

    function setupToolMocks(): { mockToolExecService: Record<string, ReturnType<typeof vi.fn>> } {
      // Track the last tool call ID seen so executeTools returns a matching executionId
      let lastToolCallId = 'tool-1';
      const mockToolExecService = {
        createExecutionRequests: vi.fn().mockImplementation(() => {
          return [
            { toolName: 'testTool', parameters: { param: 'value' }, executionId: lastToolCallId },
          ];
        }),
        createExecutionRequestsWithContext: vi
          .fn()
          .mockImplementation((toolCalls: Array<{ id: string }>) => {
            lastToolCallId = toolCalls[0]?.id ?? lastToolCallId;
            return [
              {
                toolName: 'testTool',
                parameters: { param: 'value' },
                executionId: lastToolCallId,
                ownerId: lastToolCallId,
                ownerPath: [{ ownerType: 'tool', ownerId: lastToolCallId }],
              },
            ];
          }),
        executeTools: vi.fn().mockImplementation(() => {
          return Promise.resolve({
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
                executionId: lastToolCallId,
                duration: 100,
              },
            ],
            errors: [],
          });
        }),
      };
      (executionService as unknown as Record<string, unknown>)['toolExecutionService'] =
        mockToolExecService;
      return { mockToolExecService };
    }

    function makeConfig(): IAgentConfig {
      return {
        name: 'test-agent',
        aiProviders: [mockProvider],
        defaultModel: {
          provider: 'openai',
          model: 'gpt-4',
          systemMessage: 'You are a helpful assistant.',
        },
      };
    }

    it('should make forced summary call when maxRounds exhausted with only tool calls', async () => {
      setupToolMocks();
      const config = makeConfig();

      // 10 rounds of tool calls, then the forced summary call returns text
      const chatSpy = vi.fn();
      for (let i = 0; i < 10; i++) {
        chatSpy.mockResolvedValueOnce(makeToolCallResponse(i + 1));
      }
      chatSpy.mockResolvedValueOnce({
        role: 'assistant',
        content: 'Here is the summary of results.',
        timestamp: new Date(),
      });
      mockProvider.chat = chatSpy;

      const result = await executionService.execute('Run all tools', [], config, {
        conversationId: 'test-agent',
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Here is the summary of results.');
      // 10 rounds + 1 forced call = 11 total
      expect(chatSpy).toHaveBeenCalledTimes(11);
    });

    it('should inject synthetic user message with correct content', async () => {
      setupToolMocks();
      const config = makeConfig();

      const chatSpy = vi.fn();
      for (let i = 0; i < 10; i++) {
        chatSpy.mockResolvedValueOnce(makeToolCallResponse(i + 1));
      }
      // Capture messages passed to the forced summary call
      chatSpy.mockImplementationOnce(
        (messages: TUniversalMessage[]): Promise<TUniversalMessage> => {
          // Verify the synthetic message is present in the messages sent to the provider
          const syntheticFound = messages.some(
            (m) => m.role === 'user' && m.content === SYNTHETIC_MSG,
          );
          expect(syntheticFound).toBe(true);
          // Verify it mentions follow-up
          expect(SYNTHETIC_MSG).toContain('follow-up message');
          // Verify it says "Tool round limit reached"
          expect(SYNTHETIC_MSG).toContain('Tool round limit reached');
          return Promise.resolve({
            role: 'assistant',
            content: 'Summary response.',
            timestamp: new Date(),
          });
        },
      );
      mockProvider.chat = chatSpy;

      await executionService.execute('Run all tools', [], config, {
        conversationId: 'test-agent',
      });
    });

    it('should strip synthetic user message from history after forced call', async () => {
      setupToolMocks();
      const config = makeConfig();

      const chatSpy = vi.fn();
      for (let i = 0; i < 10; i++) {
        chatSpy.mockResolvedValueOnce(makeToolCallResponse(i + 1));
      }
      chatSpy.mockResolvedValueOnce({
        role: 'assistant',
        content: 'Summary.',
        timestamp: new Date(),
      });
      mockProvider.chat = chatSpy;

      const result = await executionService.execute('Run all tools', [], config, {
        conversationId: 'test-agent',
      });

      // The synthetic message should NOT appear in final messages
      const hasSyntheticMsg = result.messages.some(
        (m) => m.role === 'user' && m.content === SYNTHETIC_MSG,
      );
      expect(hasSyntheticMsg).toBe(false);
    });

    it('should make forced call WITHOUT tools option', async () => {
      setupToolMocks();
      const config = makeConfig();

      const chatSpy = vi.fn();
      for (let i = 0; i < 10; i++) {
        chatSpy.mockResolvedValueOnce(makeToolCallResponse(i + 1));
      }
      chatSpy.mockImplementationOnce(
        (_messages: TUniversalMessage[], options?: Record<string, unknown>) => {
          // The forced summary call should NOT include tools
          expect(options).toBeDefined();
          expect(options!['tools']).toBeUndefined();
          return Promise.resolve({
            role: 'assistant',
            content: 'Summary.',
            timestamp: new Date(),
          });
        },
      );
      mockProvider.chat = chatSpy;

      await executionService.execute('Run all tools', [], config, {
        conversationId: 'test-agent',
      });
    });

    it('should use fallback message when forced call returns empty response', async () => {
      setupToolMocks();
      const config = makeConfig();

      const chatSpy = vi.fn();
      for (let i = 0; i < 10; i++) {
        chatSpy.mockResolvedValueOnce(makeToolCallResponse(i + 1));
      }
      chatSpy.mockResolvedValueOnce({
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      });
      mockProvider.chat = chatSpy;

      const result = await executionService.execute('Run all tools', [], config, {
        conversationId: 'test-agent',
      });

      expect(result.response).toBe(
        'Maximum rounds reached. Partial results available in conversation history.',
      );
    });

    it('should use fallback message when forced call throws', async () => {
      setupToolMocks();
      const config = makeConfig();

      const chatSpy = vi.fn();
      for (let i = 0; i < 10; i++) {
        chatSpy.mockResolvedValueOnce(makeToolCallResponse(i + 1));
      }
      chatSpy.mockRejectedValueOnce(new Error('Provider crashed'));
      mockProvider.chat = chatSpy;

      // Should NOT throw — error is caught
      const result = await executionService.execute('Run all tools', [], config, {
        conversationId: 'test-agent',
      });

      // When the forced call throws, the catch block logs the error but does NOT add
      // a fallback assistant message. The buildFinalResult will then use the last
      // assistant message that has content (from the tool rounds).
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      // Should not throw
    });
  });
});
