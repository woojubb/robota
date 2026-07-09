import { describe, expect, it } from 'vitest';

import { toOpenAICompatibleToolChoice, toOpenAIResponsesToolChoice } from './tool-choice';

describe('toOpenAICompatibleToolChoice (CORE-017)', () => {
  it("keeps the wire default 'auto' when the directive is unset or 'auto'", () => {
    expect(toOpenAICompatibleToolChoice(undefined)).toBe('auto');
    expect(toOpenAICompatibleToolChoice('auto')).toBe('auto');
  });

  it('passes none/required through', () => {
    expect(toOpenAICompatibleToolChoice('none')).toBe('none');
    expect(toOpenAICompatibleToolChoice('required')).toBe('required');
  });

  it('maps a named directive to the nested Chat Completions function shape', () => {
    expect(toOpenAICompatibleToolChoice({ tool: 'get_weather' })).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });
});

describe('toOpenAIResponsesToolChoice (CORE-017)', () => {
  it("keeps 'auto' for unset/auto and passes none/required through", () => {
    expect(toOpenAIResponsesToolChoice(undefined)).toBe('auto');
    expect(toOpenAIResponsesToolChoice('auto')).toBe('auto');
    expect(toOpenAIResponsesToolChoice('none')).toBe('none');
    expect(toOpenAIResponsesToolChoice('required')).toBe('required');
  });

  it('maps a named directive to the flat Responses function shape', () => {
    expect(toOpenAIResponsesToolChoice({ tool: 'get_weather' })).toEqual({
      type: 'function',
      name: 'get_weather',
    });
  });
});
