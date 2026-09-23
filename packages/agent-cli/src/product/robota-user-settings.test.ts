import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRobotaUserSettingsSources } from './robota-user-settings.js';

describe('Robota user settings layers', () => {
  it('keeps the existing Robota then Claude precedence under the supplied home', () => {
    expect(createRobotaUserSettingsSources('/test-home').map((source) => source.path)).toEqual([
      join('/test-home', '.robota', 'settings.json'),
      join('/test-home', '.claude', 'settings.json'),
    ]);
  });
});
