import { describe, expect, it } from 'vitest';

import { resolveProductTerminalCapabilities } from '../terminal-capabilities-projection.js';

describe('test-product Agent terminal capability projection', () => {
  it('maps exact 1 and 0 values to host choices', () => {
    expect(
      resolveProductTerminalCapabilities({
        PRODUCT_IME_CURSOR: '1',
        PRODUCT_TURN_MARKS: '0',
      }),
    ).toEqual({ imeCursorPositioning: true, turnMarks: false });
    expect(
      resolveProductTerminalCapabilities({
        PRODUCT_IME_CURSOR: '0',
        PRODUCT_TURN_MARKS: '1',
      }),
    ).toEqual({ imeCursorPositioning: false, turnMarks: true });
  });

  it('leaves absent and invalid values to neutral terminal detection', () => {
    expect(resolveProductTerminalCapabilities({})).toEqual({});
    expect(
      resolveProductTerminalCapabilities({
        PRODUCT_IME_CURSOR: ' 1 ',
        PRODUCT_TURN_MARKS: 'yes',
      }),
    ).toEqual({});
  });
});
