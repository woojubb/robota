import { describe, expect, it } from 'vitest';

import { toolResultValue } from './tool-result-value';

describe('toolResultValue', () => {
  it('keeps a denied tool result as an error while preserving its recorded denial payload', () => {
    expect(() =>
      toolResultValue('Read', {
        success: false,
        error: 'Hook could not evaluate (nonzero-exit, source: command)',
        data: '{"blocked":true,"reason":"hook failed"}',
      }),
    ).toThrow(/"blocked":true/);
  });
});
