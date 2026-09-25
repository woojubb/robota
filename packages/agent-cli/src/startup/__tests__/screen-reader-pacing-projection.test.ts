import { describe, expect, it } from 'vitest';

import { resolveRobotaScreenReaderPacing } from '../screen-reader-pacing-projection.js';

describe('Robota screen-reader pacing projection', () => {
  it('passes raw CLI overrides with their exact diagnostic names', () => {
    expect(resolveRobotaScreenReaderPacing({
      ROBOTA_SCREEN_READER_STARTUP_QUIET_MS: '0',
      ROBOTA_SCREEN_READER_PREPARK_MS: 'soon',
    })).toEqual({
      startupQuiet: {
        raw: '0',
        label: 'ROBOTA_SCREEN_READER_STARTUP_QUIET_MS',
      },
      prepark: {
        raw: 'soon',
        label: 'ROBOTA_SCREEN_READER_PREPARK_MS',
      },
    });
  });
});
