import { describe, expect, it } from 'vitest';

import { createHandoffCommandModule } from '../handoff-command-module.js';

describe('/handoff command module', () => {
  it('is user-only: never model-invocable, and palette metadata matches the executable', () => {
    const module = createHandoffCommandModule();
    const palette = module.commandSources?.[0]?.getCommands()[0];
    const executable = module.systemCommands?.[0];
    expect(executable?.modelInvocable).toBe(false);
    expect(palette?.modelInvocable).toBe(false);
    expect(executable?.userInvocable).toBe(true);
    expect(palette?.userInvocable).toBe(true);
    expect(executable?.description).toBe(palette?.description);
  });

  it('tells the model what it does and which command to suggest, since it cannot run it', () => {
    const description =
      createHandoffCommandModule().commandSources?.[0]?.getCommands()[0]?.description;
    expect(description).toContain('/handoff <session-id>');
    expect(description).toMatch(/user-only/i);
    expect(description).toContain('saved, not started');
  });
});
