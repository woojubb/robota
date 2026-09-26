import { describe, expect, it, vi } from 'vitest';

import { executeEventsCommand } from '../events-command.js';
import { createEventsCommandModule } from '../events-command-module.js';

import type { ICommandExternalEventsAdapter } from '@robota-sdk/agent-framework';

function adapter(): ICommandExternalEventsAdapter & { revoke: ReturnType<typeof vi.fn> } {
  return {
    list: () => [
      {
        grantId: 'ci',
        principal: 'client',
        state: 'open',
        counters: { accepted: 2, refused: { expired: 1 }, settled: { completed: 2 } },
      },
    ],
    revoke: vi.fn((grantId: string) => (grantId === 'ci' ? 'revoked' : 'unknown-grant')),
  };
}

const context = (externalEvents?: ICommandExternalEventsAdapter) => ({
  getCommandHostAdapters: () => (externalEvents ? { externalEvents } : {}),
});

describe('/events command module', () => {
  it('is user-only: never model-invocable, and palette metadata matches the executable', () => {
    const module = createEventsCommandModule();
    const palette = module.commandSources?.[0]?.getCommands()[0];
    const executable = module.systemCommands?.[0];
    expect(palette?.name).toBe('events');
    expect(executable?.modelInvocable).toBe(false);
    expect(palette?.modelInvocable).toBe(false);
    expect(executable?.userInvocable).toBe(true);
    expect(executable?.description).toBe(palette?.description);
  });

  it('tells the model what it does, what it returns, that it is user-only, and what to suggest', () => {
    const description =
      createEventsCommandModule().commandSources?.[0]?.getCommands()[0]?.description;
    expect(description).toMatch(/external event grants/i);
    expect(description).toMatch(/returns/i);
    expect(description).toMatch(/user-only/i);
    expect(description).toContain('`/events revoke <grant-id>`');
  });
});

describe('/events', () => {
  it('lists grants with their principal kind and counts', async () => {
    const result = await executeEventsCommand(context(adapter()), '');
    expect(result.success).toBe(true);
    expect(result.message).toContain(
      'ci  client  open  accepted 2; refused: expired 1; settled: completed 2',
    );
  });

  it('revokes one grant by label and says when the label is unknown', async () => {
    const events = adapter();
    expect((await executeEventsCommand(context(events), 'revoke ci')).message).toMatch(
      /Revoked external event grant ci/,
    );
    expect(events.revoke).toHaveBeenCalledWith('ci');
    const unknown = await executeEventsCommand(context(events), 'revoke nope');
    expect(unknown.success).toBe(false);
    expect(unknown.message).toMatch(/no external event grant nope/);
    expect((await executeEventsCommand(context(events), 'revoke')).success).toBe(false);
  });

  it('says how grants are given when the session holds none', async () => {
    const result = await executeEventsCommand(context(), '');
    expect(result.message).toMatch(/only when a session starts/);
  });
});
