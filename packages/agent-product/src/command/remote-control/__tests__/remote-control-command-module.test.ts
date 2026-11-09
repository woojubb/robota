import { describe, expect, it } from 'vitest';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createRemoteControlCommandModule } from '../remote-control-command-module.js';

describe('createRemoteControlCommandModule metadata', () => {
  it('keeps palette metadata aligned with the executable command and status as the safe default', async () => {
    const module = createRemoteControlCommandModule();
    const palette = module.commandSources?.[0]?.getCommands()[0];
    const executable = module.systemCommands?.[0];

    expect(palette).toBeDefined();
    expect(executable).toBeDefined();
    expect(palette?.argumentHint).toBe('[enable|stop|status|devices|revoke <device-id>]');
    expect(palette?.description).toBe(executable?.description);
    expect(palette?.modelInvocable).toBe(executable?.modelInvocable);
    expect(palette?.argumentHint).toBe(executable?.argumentHint);
    expect(palette?.userInvocable).toBe(executable?.userInvocable);
    expect(palette?.subcommands?.map(({ name }) => name)).toEqual([
      'status',
      'devices',
      'enable',
      'stop',
      'revoke',
    ]);
    expect(palette?.subcommands).toEqual(executable?.subcommands);
    expect(executable?.requiresPermission).toBe(false);
    expect(executable?.modelInvocable).toBe(false);
    expect(executable?.userInvocable).toBe(true);

    const result = await executable!.execute(createTestCommandHost(), 'status');
    expect(result.message).toContain('not available');
    expect(result.hostActions).toBeUndefined();
  });
});
