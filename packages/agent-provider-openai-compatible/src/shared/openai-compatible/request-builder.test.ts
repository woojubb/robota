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

describe('buildOpenAICompatibleRequestParams — response_format (PROV-004 / CORE-043)', () => {
  // The builder is the ONE place that decides what a compat request carries, and it dropped
  // `IChatOptions.responseFormat` entirely — so attempt 1 carried no schema signal and success
  // depended on the prose retry loop `outputRetries: 0` disables. Emission is gated on the DECLARED
  // capability because the two facts had drifted in opposite directions: deepseek's table declares
  // `json_schema` while nothing sent the field, and qwen's omits it while the documented deployment
  // targets include servers that reject unknown parameters.
  const DECLARING = {
    vendorDefault: ['tools', 'json_schema', 'streaming'],
    verifiedAt: '2026-01-01',
    sourceUrl: 'https://example.invalid/models',
  } as const;
  const SILENT = {
    vendorDefault: ['tools', 'streaming'],
    verifiedAt: '2026-01-01',
    sourceUrl: 'https://example.invalid/models',
  } as const;

  const SCHEMA_OPTIONS = {
    model: 'test-model',
    responseFormat: { type: 'json_schema', schema: { type: 'object' }, name: 'Answer' },
  } as unknown as IChatOptions;

  const build = (options: IChatOptions | undefined, table?: unknown) =>
    buildOpenAICompatibleRequestParams({
      messages: MESSAGES,
      options,
      defaultModel: 'test-model',
      ...(table === undefined ? {} : { capabilityTable: table as never }),
    }) as unknown as Record<string, unknown>;

  it('emits response_format for a model that declares json_schema', () => {
    expect(build(SCHEMA_OPTIONS, DECLARING).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'Answer', schema: { type: 'object' } },
    });
  });

  it('emits nothing for a model whose table omits json_schema', () => {
    expect(build(SCHEMA_OPTIONS, SILENT)).not.toHaveProperty('response_format');
  });

  it('emits nothing when the provider publishes no capability table at all', () => {
    // Silence is not permission — this is the branch gemma takes, and it must stay today's behaviour.
    expect(build(SCHEMA_OPTIONS)).not.toHaveProperty('response_format');
  });

  it('emits nothing when the caller asked for no response format', () => {
    const options = { model: 'test-model' } as unknown as IChatOptions;
    expect(build(options, DECLARING)).not.toHaveProperty('response_format');
  });

  it('carries a non-schema format type through unchanged', () => {
    const options = {
      model: 'test-model',
      responseFormat: { type: 'json_object' },
    } as unknown as IChatOptions;
    expect(build(options, DECLARING).response_format).toEqual({ type: 'json_object' });
  });
});
