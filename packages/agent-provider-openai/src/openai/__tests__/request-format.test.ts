import { describe, it, expect } from 'vitest';

import { buildOpenAIChatResponseFormat, mergeChatResponseFormat } from '../openai-request-format';

import type { IOpenAIProviderOptions } from '../types';

const providerOptions: IOpenAIProviderOptions = { apiKey: 'test-key' };

describe('mergeChatResponseFormat (CORE-015)', () => {
  it('returns provider options untouched when no chat responseFormat is set', () => {
    expect(mergeChatResponseFormat(providerOptions, undefined)).toBe(providerOptions);
  });

  it('carries a json_schema chat option with its schema payload into jsonSchema', () => {
    const schema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    };
    const merged = mergeChatResponseFormat(providerOptions, {
      type: 'json_schema',
      name: 'report',
      schema,
    });

    expect(merged.responseFormat).toBe('json_schema');
    expect(merged.jsonSchema).toEqual({ name: 'report', schema });
  });

  it('defaults the schema name when omitted', () => {
    const merged = mergeChatResponseFormat(providerOptions, {
      type: 'json_schema',
      schema: { type: 'object', properties: {} },
    });
    expect(merged.jsonSchema?.name).toBe('structured_output');
  });

  it('maps text/json_object formats without a schema payload', () => {
    expect(mergeChatResponseFormat(providerOptions, { type: 'json_object' }).responseFormat).toBe(
      'json_object',
    );
    expect(mergeChatResponseFormat(providerOptions, { type: 'text' }).responseFormat).toBe('text');
  });

  it('composes with buildOpenAIChatResponseFormat into response_format json_schema', () => {
    const schema = {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    };
    const format = buildOpenAIChatResponseFormat(
      mergeChatResponseFormat(providerOptions, { type: 'json_schema', name: 'report', schema }),
    );
    expect(format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'report', schema },
    });
  });
});
