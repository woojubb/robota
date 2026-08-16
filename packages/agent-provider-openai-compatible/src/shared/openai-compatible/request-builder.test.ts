import { describe, expect, it } from 'vitest';

import { buildOpenAICompatibleRequestParams } from './request-builder';

import type { IChatOptions, IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';

const MESSAGES: TUniversalMessage[] = [
  { role: 'user', content: 'hello', timestamp: new Date(0) },
] as unknown as TUniversalMessage[];

const TOOLS: IToolSchema[] = [
  {
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

describe('buildOpenAICompatibleRequestParams (PROV-004 / CORE-043)', () => {
  it('prefers the per-call model over the provider default', () => {
    const params = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: { model: 'per-call' } as IChatOptions,
      defaultModel: 'provider-default',
    });

    expect(params.model).toBe('per-call');
  });

  it('falls back to the provider default when the call names no model', () => {
    const params = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: undefined,
      defaultModel: 'provider-default',
    });

    expect(params.model).toBe('provider-default');
  });

  it('throws when neither the call nor the provider names a model', () => {
    expect(() =>
      buildOpenAICompatibleRequestParams({
        messages: MESSAGES,
        options: undefined,
        defaultModel: undefined,
      }),
    ).toThrow(/Model is required in chat options/);
  });

  it('omits optional fields the caller did not set, rather than sending them as undefined', () => {
    const params = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: undefined,
      defaultModel: 'm',
    });

    expect(Object.keys(params).sort()).toEqual(['messages', 'model']);
  });

  it('passes temperature and maxTokens through under their wire names', () => {
    const params = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: { temperature: 0.25, maxTokens: 64 } as IChatOptions,
      defaultModel: 'm',
    });

    expect(params.temperature).toBe(0.25);
    expect(params.max_tokens).toBe(64);
  });

  it('sends tools together with a tool_choice, and neither without the other', () => {
    const withTools = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: { tools: TOOLS, toolChoice: { tool: 'read_file' } } as IChatOptions,
      defaultModel: 'm',
    });

    expect(withTools.tools).toHaveLength(1);
    expect(withTools.tool_choice).toEqual({ type: 'function', function: { name: 'read_file' } });

    const withoutTools = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: { toolChoice: 'required' } as IChatOptions,
      defaultModel: 'm',
    });

    expect(withoutTools.tools).toBeUndefined();
    expect(withoutTools.tool_choice).toBeUndefined();
  });

  it('defaults tool_choice to the wire default when tools are sent without a directive', () => {
    const params = buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options: { tools: TOOLS } as IChatOptions,
      defaultModel: 'm',
    });

    expect(params.tool_choice).toBe('auto');
  });
});
