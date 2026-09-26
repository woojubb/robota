import { describe, expect, it, vi } from 'vitest';

import { toCommandListEntry } from '../interactive-session-command-projections.js';
import { SessionSkillRouter } from '../interactive-session-skill-router.js';
import { stubSubmit } from './helpers/session-stub.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';

import type { ICommandModule, ISystemCommand } from '../../commands/index.js';

/**
 * The catalog says who runs a command. A listing entry always carries `runner`: the producer
 * resolves an absent declaration to `'runtime'` here, in one place, so a consumer never has to
 * guess whether `undefined` means "runs on the runtime" or "the producer did not say".
 */
describe('toCommandListEntry: runner and surfaces', () => {
  it('projects a command that declares no runner as runtime-run', () => {
    const entry = toCommandListEntry({ name: 'compact', description: 'Compact the context' });

    expect(entry.runner).toBe('runtime');
  });

  it('carries a client runner and its surfaces', () => {
    const entry = toCommandListEntry({
      name: 'shell',
      description: 'Open a shell',
      runner: 'client',
      surfaces: ['terminal'],
    });

    expect(entry.runner).toBe('client');
    expect(entry.surfaces).toEqual(['terminal']);
  });

  it('leaves surfaces absent when the command does not declare any', () => {
    const entry = toCommandListEntry({
      name: 'theme',
      description: 'Pick a theme',
      runner: 'client',
    });

    expect(entry).not.toHaveProperty('surfaces');
  });
});

describe('SessionSkillRouter.listCommands: the runner a system command declares reaches the catalog', () => {
  function makeCommand(name: string, extra: Partial<ISystemCommand> = {}): ISystemCommand {
    return {
      name,
      description: name,
      execute: vi.fn().mockResolvedValue({ success: true, message: `${name} ran` }),
      ...extra,
    };
  }

  function makeRouter(commands: ISystemCommand[]): SessionSkillRouter {
    const module: ICommandModule = { name: 'test-module', systemCommands: commands };
    const stubSession = createTestCommandHost();
    return new SessionSkillRouter(
      [module],
      [],
      [],
      undefined,
      () => stubSession,
      () => 'session-id',
      stubSubmit,
      async () => {},
      () => {},
      async () => '',
      async () => ({}) as never,
      (execute) => execute(),
    );
  }

  it('lists a client command with its surfaces and an undeclared one as runtime', () => {
    const router = makeRouter([
      makeCommand('editor', { runner: 'client', surfaces: ['terminal'] }),
      makeCommand('compact'),
    ]);

    const byName = new Map(router.listCommands().map((entry) => [entry.name, entry]));

    expect(byName.get('editor')).toMatchObject({ runner: 'client', surfaces: ['terminal'] });
    expect(byName.get('compact')?.runner).toBe('runtime');
    expect(byName.get('compact')).not.toHaveProperty('surfaces');
  });
});
