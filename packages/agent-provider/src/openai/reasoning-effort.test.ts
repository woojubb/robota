import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpenAIProvider } from './provider';
import {
  mapEffortToOpenAIReasoningEffort,
  resolveOpenAIReasoningOptions,
} from './reasoning-effort';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

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
    model: 'gpt-4o',
    output_text: 'ok',
    output: [],
    status: 'completed',
  });
}

describe('PRESET-008 reasoning-effort wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapEffortToOpenAIReasoningEffort', () => {
    it('passes low/medium/high through and clamps xhigh/max to high', () => {
      expect(mapEffortToOpenAIReasoningEffort('low')).toBe('low');
      expect(mapEffortToOpenAIReasoningEffort('medium')).toBe('medium');
      expect(mapEffortToOpenAIReasoningEffort('high')).toBe('high');
      expect(mapEffortToOpenAIReasoningEffort('xhigh')).toBe('high');
      expect(mapEffortToOpenAIReasoningEffort('max')).toBe('high');
    });
  });

  describe('resolveOpenAIReasoningOptions', () => {
    it('returns undefined when no effort and no static reasoning', () => {
      expect(resolveOpenAIReasoningOptions(undefined, undefined)).toBeUndefined();
    });

    it('merges per-call effort over static reasoning, preserving other fields', () => {
      expect(resolveOpenAIReasoningOptions({ summary: 'auto', effort: 'low' }, 'max')).toEqual({
        summary: 'auto',
        effort: 'high',
      });
    });
  });

  // TC-01: a call with effort set on a native-effort provider → the built request
  // carries that effort value on reasoning.effort.
  it('TC-01: threads effort onto the OpenAI Responses reasoning.effort param', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-4o', effort: 'max' });

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

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-4o', effort: 'low' });

    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'low' }) }),
      undefined,
    );
  });

  // TC-02: the framework→provider seam defaults effort to 'high'. The provider faithfully
  // maps whatever effort it receives; the default-application unit lives in agent-core
  // (execution-round-provider) and is asserted there. Here we assert that the default
  // 'high' a caller would receive maps to reasoning.effort === 'high'.
  it('TC-02: an explicit high effort (the seam default) yields reasoning.effort === high', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-4o', effort: 'high' });

    expect(client.responses.create).toHaveBeenCalledWith(
      expect.objectContaining({ reasoning: expect.objectContaining({ effort: 'high' }) }),
      undefined,
    );
  });

  it('TC-02: omits reasoning entirely when effort is unset and no static reasoning', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const client = getResponsesClient(provider);
    stubResponsesResolve(client.responses.create);

    await provider.chat([createUserMessage('Hello')], { model: 'gpt-4o' });

    const [requestParams] = client.responses.create.mock.calls[0] as [Record<string, unknown>];
    expect(requestParams).not.toHaveProperty('reasoning');
  });

  // TC-03 (doc half): the graceful no-op for non-native providers is documented in the
  // package SPEC. (The runtime no-op half is asserted in deepseek/provider.test.ts.)
  it('TC-03: the per-provider effort no-op is documented in agent-provider SPEC.md', () => {
    const specPath = join(__dirname, '..', '..', 'docs', 'SPEC.md');
    const spec = readFileSync(specPath, 'utf8');
    expect(spec).toMatch(/## Reasoning Effort/);
    expect(spec).toMatch(/ignored without error/);
    expect(spec).toMatch(/DeepSeek/);
  });
});
