import { describe, expect, it } from 'vitest';

import { resolveRobotaTerminalCapabilities } from '../terminal-capabilities-projection.js';

describe('Robota terminal capability projection', () => {
  it('maps exact 1 and 0 values to host choices', () => {
    expect(
      resolveRobotaTerminalCapabilities({
        ROBOTA_IME_CURSOR: '1',
        ROBOTA_TURN_MARKS: '0',
      }),
    ).toEqual({ imeCursorPositioning: true, turnMarks: false });
    expect(
      resolveRobotaTerminalCapabilities({
        ROBOTA_IME_CURSOR: '0',
        ROBOTA_TURN_MARKS: '1',
      }),
    ).toEqual({ imeCursorPositioning: false, turnMarks: true });
  });

  it('leaves absent and invalid values to neutral terminal detection', () => {
    expect(resolveRobotaTerminalCapabilities({})).toEqual({});
    expect(
      resolveRobotaTerminalCapabilities({
        ROBOTA_IME_CURSOR: ' 1 ',
        ROBOTA_TURN_MARKS: 'yes',
      }),
    ).toEqual({});
  });
});
