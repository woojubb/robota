import { describe, expect, it } from 'vitest';

import * as presetApi from '../index.js';

describe('neutral preset package boundary', () => {
  it('does not expose the Robota shell identity or implicit home-directory loaders', () => {
    expect(presetApi).not.toHaveProperty('DEFAULT_AGENT_NAME');
    expect(presetApi).not.toHaveProperty('defaultExternalPresetDir');
    expect(presetApi).not.toHaveProperty('loadExternalPresets');
  });
});
