import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaygroundExecutor } from '../robota-executor';
import type { IPlaygroundAgentConfig } from '../robota-executor';
import type { TSseEvent } from '../robota-executor/sse-client';

const sseMocks = vi.hoisted(() => ({
  sseExecute: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../robota-executor/sse-client', () => ({
  sseExecute: sseMocks.sseExecute,
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
    sseMocks.sseExecute.mockClear();
    sseMocks.logger.debug.mockClear();
    sseMocks.logger.error.mockClear();
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
    expect(sseMocks.sseExecute).not.toHaveBeenCalled();
  });

  it('runs prompt via SSE and accumulates text_delta into response', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseExecute.mockImplementation(
      makeEventStream(
        { type: 'text_delta', data: { text: 'hello ' } },
        { type: 'text_delta', data: { text: 'world' } },
        DONE_EVENT,
      ),
    );

    const result = await executor.run('say something');

    expect(sseMocks.sseExecute).toHaveBeenCalledWith(
      'ws://api.example.test/ws/playground',
      undefined,
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o-mini',
        message: 'say something',
      }),
    );
    expect(result).toMatchObject({
      success: true,
      response: 'hello world',
    });
  });

  it('forwards BYOK apiKey to sseExecute', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig({ apiKey: 'sk-byok-key' }));

    sseMocks.sseExecute.mockImplementation(
      makeEventStream({ type: 'text_delta', data: { text: 'ok' } }, DONE_EVENT),
    );

    await executor.run('test');

    expect(sseMocks.sseExecute).toHaveBeenCalledWith(
      expect.any(String),
      'sk-byok-key',
      expect.any(Object),
    );
  });

  it('returns failure when SSE stream emits an error event', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseExecute.mockImplementation(
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

    sseMocks.sseExecute.mockImplementation(
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

  it('includes registered tools in sseExecute request body', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());
    await executor.updateAgentToolsFromCard('agent-1', { id: 'web_search', name: 'web_search' });

    sseMocks.sseExecute.mockImplementation(
      makeEventStream({ type: 'text_delta', data: { text: 'done' } }, DONE_EVENT),
    );

    await executor.run('search something');

    expect(sseMocks.sseExecute).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ tools: ['web_search'] }),
    );
  });

  it('passes conversation history to subsequent SSE calls', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseExecute
      .mockImplementationOnce(
        makeEventStream({ type: 'text_delta', data: { text: 'first reply' } }, DONE_EVENT),
      )
      .mockImplementationOnce(
        makeEventStream({ type: 'text_delta', data: { text: 'second reply' } }, DONE_EVENT),
      );

    await executor.run('first message');
    await executor.run('second message');

    const secondCallBody = sseMocks.sseExecute.mock.calls[1]?.[2];
    expect(secondCallBody.history).toEqual([
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'first reply' },
    ]);
  });

  it('clears conversation history on clearHistory', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    sseMocks.sseExecute.mockImplementation(
      makeEventStream({ type: 'text_delta', data: { text: 'reply' } }, DONE_EVENT),
    );
    await executor.run('message');

    executor.clearHistory();
    sseMocks.sseExecute.mockClear();

    sseMocks.sseExecute.mockImplementation(
      makeEventStream({ type: 'text_delta', data: { text: 'reply2' } }, DONE_EVENT),
    );
    await executor.run('after clear');

    const body = sseMocks.sseExecute.mock.calls[0]?.[2];
    expect(body.history).toEqual([]);
  });

  it('disposes the history plugin on dispose', async () => {
    const executor = createExecutor();
    await executor.createAgent(createConfig());

    await executor.dispose();

    expect(sseMocks.logger.debug).toHaveBeenCalledWith('PlaygroundHistoryPlugin disposed');
  });
});
