import { describe, expect, it } from 'vitest';

import { createRobotaUserSettingsSources } from '../../product/robota-user-settings.js';
import { buildServeSessionOptions } from '../serve-mode.js';

describe('served session user settings sources', () => {
  it('forwards the CLI-selected sources into the runtime session', () => {
    const sources = createRobotaUserSettingsSources('/test-home');
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      userSettingsSources: sources,
    } as never);

    expect(options.userSettingsSources).toBe(sources);
  });
});
