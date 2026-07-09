import { FunctionCallingConfigMode } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { toGeminiFunctionCallingConfig } from './tool-schema-converter';

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
