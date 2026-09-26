import { describe, expect, it } from 'vitest';

import { createPeersCommandModule } from '../peers-command-module.js';

describe('/peers command module', () => {
  it('is user-only: never model-invocable, and palette metadata matches the executable', () => {
    const module = createPeersCommandModule();
    const palette = module.commandSources?.[0]?.getCommands()[0];
    const executable = module.systemCommands?.[0];
    expect(executable?.modelInvocable).toBe(false);
    expect(palette?.modelInvocable).toBe(false);
    expect(executable?.userInvocable).toBe(true);
    expect(executable?.description).toBe(palette?.description);
  });

  it('tells the model it covers linked devices, what it returns, and what to suggest', () => {
    const description =
      createPeersCommandModule().commandSources?.[0]?.getCommands()[0]?.description;
    expect(description).toMatch(/linked over the device mesh/);
    expect(description).toMatch(/returns/i);
    expect(description).toMatch(/user-only/i);
    expect(description).toContain('`/peers`');
  });
});
