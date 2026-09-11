import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpenAIProvider } from './provider';
import {
  mapEffortToOpenAIReasoningEffort,
  resolveOpenAIReasoningOptions,
} from './reasoning-effort';
import { OPENAI_MODEL_EFFORT_TABLE } from './model-effort-table';

import {
  resolveModelEffort,
  type IExecutor,
  type IModelEffortOutcome,
  type TUniversalMessage,
} from '@robota-sdk/agent-core';

// Mock OpenAI SDK (mirror provider.test.ts so chat() never hits the network).
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    responses: { create: vi.fn() },
  }));
  return { default: MockOpenAI };
});

function createUserMessage(content: string): TUniversalMessage {
  return { id: 'msg-1', state: 'complete' as const, role: 'user', content, timestamp: new Date() };
}

function getResponsesClient(provider: OpenAIProvider): {
  responses: { create: ReturnType<typeof vi.fn> };
} {
  return (provider as unknown as { client: { responses: { create: ReturnType<typeof vi.fn> } } })
    .client;
}

function stubResponsesResolve(create: ReturnType<typeof vi.fn>): void {
  create.mockResolvedValue({
    id: 'resp-effort',
    model: 'gpt-5.1',
    output_text: 'ok',
    output: [],
    status: 'completed',
  });
}

const REMOTE_EXECUTOR_OUTCOME: IModelEffortOutcome = {
  resolution: {
    selection: 'high',
    effective: 'high',
    disposition: 'exact',
    fingerprint: 'gpt-5.1|high|high|exact|responses.reasoning.effort|2026-09-11',
  },
  nativeControl: { state: 'sent', id: 'responses.reasoning.effort' },
  providerDispatch: { state: 'sent' },
};

describe('PRESET-008 reasoning-effort wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapEffortToOpenAIReasoningEffort', () => {
    it('serializes the documented Responses vocabulary without framework-side clamping', () => {
      expect(mapEffortToOpenAIReasoningEffort('none')).toBe('none');
      expect(mapEffortToOpenAIReasoningEffort('minimal')).toBe('minimal');
      expect(mapEffortToOpenAIReasoningEffort('low')).toBe('low');
      expect(mapEffortToOpenAIReasoningEffort('medium')).toBe('medium');
      expect(mapEffortToOpenAIReasoningEffort('high')).toBe('high');
      expect(mapEffortToOpenAIReasoningEffort('xhigh')).toBe('xhigh');
      expect(mapEffortToOpenAIReasoningEffort('max')).toBe('max');
    });
  });

  describe('resolveOpenAIReasoningOptions', () => {
    it('returns undefined when no effort and no static reasoning', () => {
      expect(resolveOpenAIReasoningOptions(undefined, undefined)).toBeUndefined();
    });

    it('merges a verified resolution over static non-control reasoning fields', () => {
      expect(
        resolveOpenAIReasoningOptions(
          { summary: 'auto' },
          resolveModelEffort(OPENAI_MODEL_EFFORT_TABLE, 'gpt-5.1', 'max'),
        ),
      ).toEqual({
        summary: 'auto',
        effort: 'high',
      });
    });

    it('omits the native control for auto and rejects a conflicting static effort', () => {
      expect(
        resolveOpenAIReasoningOptions(
          undefined,
          resolveModelEffort(OPENAI_MODEL_EFFORT_TABLE, 'gpt-5.1', 'auto'),
        ),
      ).toBeUndefined();
      expect(() =>
        resolveOpenAIReasoningOptions(
          { effort: 'low' },
          resolveModelEffort(OPENAI_MODEL_EFFORT_TABLE, 'gpt-5.1', 'high'),
        ),
      ).toThrow('conflicts with static reasoning.effort');
    });

    it('rejects a static native effort when auto would otherwise falsely report omission', () => {
      expect(() =>
        resolveOpenAIReasoningOptions(
          { effort: 'low', summary: 'concise' },
          resolveModelEffort(OPENAI_MODEL_EFFORT_TABLE, 'gpt-5.1', 'auto'),
        ),
      ).toThrow('provider-default selection');
    });
  });

  // TC-01: a call with effort set on a native-effort provider → the built request
  // carries that effort value on reasoning.effort.
  it('TC-01: threads effort onto the OpenAI Responses reasoning.effort param', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-5.1', effort: 'max' });

    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoning: expect.objectContaining({ effort: 'high' }),
      }),
      undefined,
    );
  });

  it('TC-01: passes a low effort straight through to reasoning.effort', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-5.1', effort: 'low' });

    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'low' }) }),
      undefined,
    );
  });

  it('TC-02: an explicit high effort yields reasoning.effort === high', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-5.1', effort: 'high' });

    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'high' }) }),
      undefined,
    );
  });

  it('TC-02: auto resolves the documented model default while omitting reasoning.effort', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-5.1', effort: 'auto' });

    const [requestParams] = client.responses.create.mock.calls[0] as [Record<string, unknown>];
    expect(requestParams).not.toHaveProperty('reasoning');
  });

  it('publishes one terminal outcome with separate resolution, native-control, and dispatch facts', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);
    const outcomes: unknown[] = [];

    await provider.chat([createUserMessage('Hello')], {
      model: 'gpt-5.1',
      effort: 'max',
      onModelEffortOutcome: (outcome) => outcomes.push(outcome),
    });

    expect(outcomes).toEqual([
      expect.objectContaining({
        resolution: expect.objectContaining({
          selection: 'max',
          effective: 'high',
          disposition: 'clamped',
        }),
        nativeControl: { state: 'sent', id: 'responses.reasoning.effort' },
        providerDispatch: { state: 'sent' },
      }),
    ]);
  });

  it('does not replace a remote executor outcome with a competing opaque-executor result', async () => {
    const executor: IExecutor = {
      name: 'remote-test',
      version: '1.0.0',
      async executeChat(request) {
        request.options?.onModelEffortOutcome?.(REMOTE_EXECUTOR_OUTCOME);
        return {
          message: {
            id: 'remote-response',
            role: 'assistant',
            content: 'ok',
            state: 'complete',
            timestamp: new Date(),
          },
          modelEffortOutcome: REMOTE_EXECUTOR_OUTCOME,
        };
      },
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const provider = new OpenAIProvider({ executor });
    const outcomes: IModelEffortOutcome[] = [];

    await provider.chat([createUserMessage('Hello')], {
      model: 'gpt-5.1',
      effort: 'high',
      onModelEffortOutcome: (outcome) => outcomes.push(outcome),
    });

    expect(outcomes).toEqual([REMOTE_EXECUTOR_OUTCOME]);
  });

  it('publishes one terminal outcome only after a Responses stream completes', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    async function* responsesStream() {
      yield { type: 'response.output_text.delta', delta: 'ok' };
      yield {
        type: 'response.completed',
        response: {
          id: 'resp-effort-stream',
          output_text: 'ok',
          output: [],
          status: 'completed',
        },
      };
    }
    client.responses.create.mockResolvedValue(responsesStream());
    const outcomes: unknown[] = [];

    for await (const _chunk of provider.chatStream([createUserMessage('Hello')], {
      model: 'gpt-5.1',
      effort: 'max',
      onModelEffortOutcome: (outcome) => outcomes.push(outcome),
    })) {
      // Consume every chunk so the terminal stream outcome is eligible to publish.
    }

    expect(outcomes).toEqual([
      expect.objectContaining({
        resolution: expect.objectContaining({ effective: 'high', disposition: 'clamped' }),
        nativeControl: { state: 'sent', id: 'responses.reasoning.effort' },
        providerDispatch: { state: 'sent' },
      }),
    ]);
  });

  it('reports the source-dated table only for the official Responses endpoint', () => {
    expect(new OpenAIProvider({ apiKey: 'sk-test' }).effortTable()).toBe(OPENAI_MODEL_EFFORT_TABLE);
    expect(
      new OpenAIProvider({
        apiKey: 'sk-test',
        apiSurface: 'chat-completions',
      }).effortTable(),
    ).toBeUndefined();
  });

  it('documents verified Responses support and unverified-surface omission in the package SPEC', () => {
    const specPath = join(__dirname, '..', '..', 'docs', 'SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    expect(spec).toMatch(/## Reasoning Effort/);
    expect(spec).toMatch(/OpenAI Responses/);
    expect(spec).toMatch(/not-applied/);
  });
});
