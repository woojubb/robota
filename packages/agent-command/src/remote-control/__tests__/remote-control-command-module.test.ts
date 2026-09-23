import { describe, expect, it } from 'vitest';

import { createRemoteControlCommandModule } from '../remote-control-command-module.js';

describe('createRemoteControlCommandModule metadata', () => {
  it('keeps palette metadata aligned with the executable command', () => {
    const module = createRemoteControlCommandModule();
    const palette = module.commandSources?.[0]?.getCommands()[0];
    const executable = module.systemCommands?.[0];

    expect(palette).toBeDefined();
    expect(executable).toBeDefined();
    expect(palette?.description).toBe(executable?.description);
    expect(palette?.modelInvocable).toBe(executable?.modelInvocable);
    expect(palette?.argumentHint).toBe(executable?.argumentHint);
    expect(palette?.userInvocable).toBe(executable?.userInvocable);
  });
});
