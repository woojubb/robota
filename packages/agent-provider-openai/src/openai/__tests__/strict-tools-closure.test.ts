import { describe, expect, it } from 'vitest';

import { convertToOpenAIResponsesTools } from '../responses-converter';

import type { IToolSchema } from '@robota-sdk/agent-core';

/**
 * PROV-007 — `strictTools` sent a schema OpenAI refuses.
 *
 * Strict mode does not accept an arbitrary JSON Schema: every object node, nested included, must
 * carry `additionalProperties: false` and list all of its properties in `required`. The universal
 * subset guarantees neither — a Zod-derived node emits `additionalProperties: true` because Zod's
 * default `strip` means "accept then drop", a hand-written one may omit the member, and `required`
 * lists only what is genuinely required.
 *
 * So a schema that is correct for this repository was rejected whenever a caller opted in — and not
 * only when it nested: an open ROOT is refused exactly as an absent member is, which made every
 * `createZodFunctionTool` tool affected, flat ones included.
 */

const NESTED_TOOL: IToolSchema = {
  name: 'create_user',
  description: 'Creates a user',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      email: { type: 'string' },
      profile: {
        type: 'object',
        additionalProperties: true,
        properties: { nickname: { type: 'string' }, bio: { type: 'string' } },
        required: ['nickname'],
      },
    },
    required: ['email'],
  },
};

describe('PROV-007 — the strict path', () => {
  it('closes and completes every object node, root and nested', () => {
    const [tool] = convertToOpenAIResponsesTools([NESTED_TOOL], true) ?? [];
    const parameters = tool?.parameters as unknown as Record<string, unknown>;

    expect(tool?.strict).toBe(true);
    expect(parameters.additionalProperties).toBe(false);
    expect(parameters.required).toEqual(['email', 'profile']);

    // `profile` was optional, so it is required-but-nullable and its schema is the first branch.
    const wrapper = (parameters.properties as Record<string, Record<string, unknown>>).profile;
    const profile = (wrapper.anyOf as Array<Record<string, unknown>>)[0];
    expect(profile.additionalProperties).toBe(false);
    expect(profile.required).toEqual(['nickname', 'bio']);
  });

  it('is not only about nesting — an open ROOT is refused too', () => {
    // The reason every tool was affected rather than only the ones with nested objects.
    const flat: IToolSchema = {
      name: 'ping',
      description: 'Pings',
      parameters: { type: 'object', additionalProperties: true, properties: {}, required: [] },
    };
    const [tool] = convertToOpenAIResponsesTools([flat], true) ?? [];

    expect((tool?.parameters as unknown as Record<string, unknown>).additionalProperties).toBe(
      false,
    );
  });
});

describe('PROV-007 — the non-strict path is left alone', () => {
  it('forwards the schema unchanged', () => {
    // The transformation is LOSSY — it forces optional fields into `required` — so running it where
    // OpenAI accepts the honest schema would rewrite a contract for no reason.
    const [tool] = convertToOpenAIResponsesTools([NESTED_TOOL], false) ?? [];

    expect(tool?.strict).toBe(false);
    expect(tool?.parameters).toBe(NESTED_TOOL.parameters);
  });

  it('treats an unset strictTools as non-strict', () => {
    const [tool] = convertToOpenAIResponsesTools([NESTED_TOOL], undefined) ?? [];

    expect(tool?.strict).toBe(false);
    expect(tool?.parameters).toBe(NESTED_TOOL.parameters);
  });
});
