import { describe, expect, it } from 'vitest';

import * as commands from '../../index.js';

describe('plugin command host boundary', () => {
  it('keeps the concrete plugin host adapter out of the command package entrypoint', () => {
    expect(commands).not.toHaveProperty('createDefaultPluginCommandAdapter');
    expect(commands).not.toHaveProperty('reloadPluginCommandSource');
    expect(commands).not.toHaveProperty('pluginScopeDirs');
  });
});
