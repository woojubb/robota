import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundExecutor } from '../robota-executor';
import type { IPlaygroundAgentConfig } from '../robota-executor';
import type { TSseEvent } from '../robota-executor/sse-client';

const sseMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  sseSessionSubmit: vi.fn(),
  destroySession: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../robota-executor/sse-client', () => ({
  createSession: sseMocks.createSession,
  sseSessionSubmit: sseMocks.sseSessionSubmit,
  destroySession: sseMocks.destroySession,
}));

function makeEventStream(...events: TSseEvent[]) {
  return async function* () {
    for (const event of events) {
      yield event;
    }
  };
}

const DONE_EVENT: TSseEvent = {
  type: 'done',
  data: { usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
};

function createExecutor(): PlaygroundExecutor {
  return new PlaygroundExecutor('ws://api.example.test/ws/playground', 'token-1', {
    eventService: {},
    logger: sseMocks.logger,
  });
}

function createConfig(overrides: Partial<IPlaygroundAgentConfig> = {}): IPlaygroundAgentConfig {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    aiProviders: [],
    defaultModel: {
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
    tools: [],
    ...overrides,
  };
}

describe('PlaygroundExecutor', () => {
  beforeEach(() => {
    sseMocks.createSession.mockReset();
    sseMocks.createSession.mockResolvedValue({ sessionId: 'test-session-id' });
    sseMocks.sseSessionSubmit.mockReset();
    sseMocks.sseSessionSubmit.mockImplementation(makeEventStream(DONE_EVENT));
    sseMocks.destroySession.mockReset();
    sseMocks.destroySession.mockResolvedValue(undefined);
    sseMocks.logger.debug.mockClear();
    sseMocks.logger.error.mockClear();
    sseMocks.logger.info.mockClear();
    sseMocks.logger.warn.mockClear();
  });

  it('creates agent and records UI interaction', async () => {
    const executor = createExecutor();

    await executor.createAgent(createConfig());

    expect(executor.getPlaygroundStatistics().uiInteractions).toBe(1);
  });

  it('returns failure when no agent is configured', async () => {
    const executor = createExecutor();

    const result = await executor.run('hello');

    expect(result).toMatchObject({
      success: false,
      response: 'No agent configured',
    });
    expect(sseMocks.sseSessionSubmit).not.toHaveBeenCalled();
  });

  it('runs prompt via SSE and accumulates text_delta into response', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseSessionSubmit.mockImplementation(
      makeEventStream(
        { type: 'text_delta', data: { text: 'hello ' } },
        { type: 'text_delta', data: { text: 'world' } },
        DONE_EVENT,
      ),
    );

    const result = await executor.run('say something');

    expect(sseMocks.sseSessionSubmit).toHaveBeenCalledWith(
      'ws://api.example.test/ws/playground',
      undefined,
      'test-session-id',
      'say something',
    );
    expect(result).toMatchObject({
      success: true,
      response: 'hello world',
    });
  });

  it('forwards BYOK apiKey to createSession', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig({ apiKey: 'sk-byok-key' }));

    expect(sseMocks.createSession).toHaveBeenCalledWith(
      expect.any(String),
      'sk-byok-key',
      expect.any(Object),
    );
  });

  it('returns failure when SSE stream emits an error event', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseSessionSubmit.mockImplementation(
      makeEventStream({ type: 'error', data: { message: 'Provider error' } }),
    );

    const result = await executor.run('test');

    expect(result).toMatchObject({
      success: false,
      response: 'Execution failed',
    });
  });

  it('executes prompt and calls onChunk for each text_delta', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseSessionSubmit.mockImplementation(
      makeEventStream(
        { type: 'text_delta', data: { text: 'part1' } },
        { type: 'text_delta', data: { text: 'part2' } },
        DONE_EVENT,
      ),
    );

    const onChunk = vi.fn();
    const result = await executor.execute('direct', onChunk);

    expect(onChunk).toHaveBeenCalledWith('part1');
    expect(onChunk).toHaveBeenCalledWith('part2');
    expect(result).toMatchObject({
      success: true,
      response: 'part1part2',
    });
  });

  it('adds tool IDs via updateAgentToolsFromCard', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    await executor.updateAgentToolsFromCard('agent-1', {
      id: 'tool-calculator',
      name: 'calculator',
      description: 'A calculator',
    });

    const config = await executor.getAgentConfiguration('agent-1');
    expect(config.tools).toEqual([{ name: 'tool-calculator' }]);
  });

  it('deduplicates tool IDs on repeated updateAgentToolsFromCard calls', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    await executor.updateAgentToolsFromCard('agent-1', {
      id: 'tool-a',
      name: 'a',
      description: 'A',
    });
    await executor.updateAgentToolsFromCard('agent-1', {
      id: 'tool-a',
      name: 'a',
      description: 'A',
    });

    const config = await executor.getAgentConfiguration('agent-1');
    expect(config.tools).toEqual([{ name: 'tool-a' }]);
  });

  it('stores registered tools in agent configuration', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());
    await executor.updateAgentToolsFromCard('agent-1', { id: 'web_search', name: 'web_search' });

    const config = await executor.getAgentConfiguration('agent-1');
    expect(config.tools).toEqual([{ name: 'web_search' }]);
  });

  it('submits subsequent prompts via same session ID', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    await executor.run('first message');
    await executor.run('second message');

    expect(sseMocks.sseSessionSubmit).toHaveBeenCalledTimes(2);
    expect(sseMocks.sseSessionSubmit).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      undefined,
      'test-session-id',
      'second message',
    );
  });

  it('clears visualization events on clearHistory', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseSessionSubmit.mockImplementation(
      makeEventStream({ type: 'text_delta', data: { text: 'reply' } }, DONE_EVENT),
    );
    await executor.run('message');

    executor.clearHistory();

    expect(executor.getVisualizationData().events).toHaveLength(0);
  });

  it('does not record events into historyPlugin after clearHistory is called mid-execution', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    // Stream that yields one event, then we'll call clearHistory, then yield another
    let resolveNext!: () => void;
    const gate = new Promise<void>((res) => {
      resolveNext = res;
    });

    sseMocks.sseSessionSubmit.mockImplementation(() =>
      (async function* () {
        yield { type: 'text_delta', data: { text: 'before' } } as TSseEvent;
        // Pause — caller will call clearHistory() and then allow continuation
        await gate;
        yield { type: 'text_delta', data: { text: 'after' } } as TSseEvent;
        yield DONE_EVENT;
      })(),
    );

    const runPromise = executor.run('prompt');

    // Allow the first event to be processed, then clear
    await new Promise((r) => setTimeout(r, 0));
    executor.clearHistory();
    resolveNext();

    await runPromise;

    // Only events recorded after the clear would appear; historyPlugin should be empty
    // because clearHistory() increments executionToken, causing the loop to break
    expect(executor.getVisualizationData().events).toHaveLength(0);
  });

  it('calls destroySession and disposes history plugin on dispose', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    await executor.dispose();

    expect(sseMocks.destroySession).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      'test-session-id',
    );
    expect(sseMocks.logger.debug).toHaveBeenCalledWith('PlaygroundHistoryPlugin disposed');
  });
});
