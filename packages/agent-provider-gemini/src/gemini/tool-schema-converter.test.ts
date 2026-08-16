import { FunctionCallingConfigMode, Type } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { convertToolsToGeminiFormat, toGeminiFunctionCallingConfig } from './tool-schema-converter';

import type { IToolSchema } from '@robota-sdk/agent-core';

describe('toGeminiFunctionCallingConfig (CORE-017)', () => {
  it('maps auto/none to the matching Gemini modes', () => {
    expect(toGeminiFunctionCallingConfig('auto')).toEqual({
      mode: FunctionCallingConfigMode.AUTO,
    });
    expect(toGeminiFunctionCallingConfig('none')).toEqual({
      mode: FunctionCallingConfigMode.NONE,
    });
  });

  it("maps 'required' to mode ANY (model must call some declared function)", () => {
    expect(toGeminiFunctionCallingConfig('required')).toEqual({
      mode: FunctionCallingConfigMode.ANY,
    });
  });

  it('maps a named directive to ANY constrained to that function name', () => {
    expect(toGeminiFunctionCallingConfig({ tool: 'get_weather' })).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ['get_weather'],
    });
  });
});

/**
 * CORE-039 — this mapper rebuilds every node from a fixed key list, so a subset member it does not
 * copy is dropped without a trace. `required` below the root and `anyOf` anywhere are members the
 * Gemini SDK's own `Schema` carries; omitting them told the model every nested field was optional
 * and erased union branches entirely.
 */
describe('convertToolsToGeminiFormat — nested subset members survive (CORE-039)', () => {
  const tool: IToolSchema = {
    name: 'report',
    description: 'report',
    parameters: {
      type: 'object',
      properties: {
        report: {
          type: 'object',
          properties: { score: { type: 'number' }, note: { type: 'string' } },
          required: ['score'],
        },
        choice: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { label: { type: 'string' } },
              required: ['label'],
            },
          ],
        },
      },
      required: ['report'],
    },
  };

  it('forwards a nested object required list', () => {
    const [declaration] = convertToolsToGeminiFormat([tool]);
    expect(declaration?.parameters?.properties?.['report']?.required).toEqual(['score']);
  });

  it('forwards a union node as anyOf, recursing into each branch', () => {
    const [declaration] = convertToolsToGeminiFormat([tool]);
    const choice = declaration?.parameters?.properties?.['choice'];
    expect(choice?.anyOf).toHaveLength(2);
    expect(choice?.anyOf?.[1]?.properties?.['label']?.type).toBe(Type.STRING);
    expect(choice?.anyOf?.[1]?.required).toEqual(['label']);
  });

  it('emits no type on the union node, which JSON Schema forbids beside anyOf', () => {
    const [declaration] = convertToolsToGeminiFormat([tool]);
    expect(declaration?.parameters?.properties?.['choice']?.type).toBeUndefined();
  });
});
