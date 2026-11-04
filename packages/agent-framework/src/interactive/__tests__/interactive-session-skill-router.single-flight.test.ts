import { describe, expect, it, vi } from 'vitest';

import { SessionSkillRouter } from '../interactive-session-skill-router.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { stubSubmit } from './helpers/session-stub.js';

import type { ICommandModule, ISystemCommand } from '../../commands/index.js';
import type { IFrameworkHost } from '../../host/framework-host.js';

/**
 * A host with no `createAsyncScope` (a browser) cannot give each command a scope that follows its own
 * call chain. The router then runs one user or remote command at a time and says so to a second,
 * because two overlapping commands would read each other's source, and a model command could read as
 * a user's. A host that has a scope keeps today's behaviour: every command sees its own.
 */
const withScope = createTestFrameworkHost().createAsyncScope;
const withoutScope: IFrameworkHost['createAsyncScope'] = undefined;

/** A promise the test settles by hand. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function command(name: string, execute: ISystemCommand['execute'], extra = {}): ISystemCommand {
  return { name, description: name, lifecycle: 'inline', execute, ...extra } as ISystemCommand;
}

function makeRouter(
  commands: ISystemCommand[],
  createAsyncScope: IFrameworkHost['createAsyncScope'],
): SessionSkillRouter {
  const module: ICommandModule = { name: 'single-flight', systemCommands: commands };
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
    createAsyncScope,
  );
}

const REFUSAL = /Another command is already running/;

describe('SessionSkillRouter on a host without an async scope', () => {
  it('runs one user or remote command at a time and refuses a second without running it', async () => {
    const held = gate();
    const quick = vi.fn(async () => ({ success: true, message: 'quick ran' }));
    const router = makeRouter(
      [
        command('slow', async () => {
          await held.wait;
          return { success: true, message: 'slow ran' };
        }),
        command('quick', quick),
      ],
      withoutScope,
    );

    const slow = router.executeCommand('slow', '', 'user');
    const refused = await router.executeCommand('quick', '', 'remote');

    expect(refused).toMatchObject({ success: false, message: expect.stringMatching(REFUSAL) });
    expect(quick).not.toHaveBeenCalled();
    held.open();
    expect(await slow).toMatchObject({ success: true, message: 'slow ran' });
    // The refusal lasted only while the first command ran.
    expect(await router.executeCommand('quick', '', 'remote')).toMatchObject({ success: true });
    expect(quick).toHaveBeenCalledTimes(1);
  });

  it('lets the next command in after one fails', async () => {
    const router = makeRouter(
      [
        command('broken', async () => {
          throw new Error('command failed');
        }),
        command('quick', async () => ({ success: true, message: 'quick ran' })),
      ],
      withoutScope,
    );

    await expect(router.executeCommand('broken', '', 'user')).rejects.toThrow('command failed');
    expect(await router.executeCommand('quick', '', 'user')).toMatchObject({ success: true });
  });

  it('keeps a model command reading as a model command while a user command is turned away', async () => {
    const held = gate();
    const sources: string[] = [];
    let router: SessionSkillRouter;
    router = makeRouter(
      [
        command(
          'ask',
          async () => {
            await held.wait;
            sources.push(router.getCommandInvocationSource());
            return { success: true, message: 'asked' };
          },
          { modelInvocable: true },
        ),
        command('operator', async () => {
          sources.push(router.getCommandInvocationSource());
          return { success: true, message: 'operated' };
        }),
      ],
      withoutScope,
    );

    const model = router.executeModelCommand('ask', '');
    const refused = await router.executeCommand('operator', '', 'user');
    held.open();
    await model;

    expect(refused).toMatchObject({ success: false, message: expect.stringMatching(REFUSAL) });
    // The refused command never ran, so it could not have been read as the model's source or the other way round.
    expect(sources).toEqual(['model']);
  });

  it('lets model commands overlap, each reading its own source, and a model command run inside a user command', async () => {
    const held = gate();
    const sources: string[] = [];
    let router: SessionSkillRouter;
    router = makeRouter(
      [
        command(
          'lookup',
          async () => {
            await held.wait;
            sources.push(`lookup:${router.getCommandInvocationSource()}`);
            return { success: true, message: 'looked up' };
          },
          { modelInvocable: true },
        ),
        // A user command that starts a turn, whose model calls a command, then reads its own source again.
        command('turn', async () => {
          sources.push(`turn-before:${router.getCommandInvocationSource()}`);
          await router.executeModelCommand('lookup', '');
          sources.push(`turn-after:${router.getCommandInvocationSource()}`);
          return { success: true, message: 'turn done' };
        }),
      ],
      withoutScope,
    );

    const parallel = [
      router.executeModelCommand('lookup', ''),
      router.executeModelCommand('lookup', ''),
    ];
    held.open();
    await Promise.all(parallel);
    expect(sources).toEqual(['lookup:model', 'lookup:model']);

    sources.length = 0;
    const result = await router.executeCommand('turn', '', 'user');
    expect(result).toMatchObject({ success: true, message: 'turn done' });
    expect(sources).toEqual(['turn-before:user', 'lookup:model', 'turn-after:user']);
  });

  it('answers a model command that arrives mid-user-command, not with a refusal', async () => {
    const held = gate();
    const router = makeRouter(
      [
        command('slow', async () => {
          await held.wait;
          return { success: true, message: 'slow ran' };
        }),
        command('lookup', async () => ({ success: true, message: 'looked up' }), {
          modelInvocable: true,
        }),
      ],
      withoutScope,
    );

    const slow = router.executeCommand('slow', '', 'user');
    expect(await router.executeModelCommand('lookup', '')).toMatchObject({
      success: true,
      message: 'looked up',
    });
    held.open();
    await slow;
  });
});

describe('SessionSkillRouter on a host with an async scope', () => {
  it('runs commands at once, each reading the source it was started with', async () => {
    const held = gate();
    const sources: string[] = [];
    let router: SessionSkillRouter;
    router = makeRouter(
      [
        command('slow', async () => {
          await held.wait;
          sources.push(`slow:${router.getCommandInvocationSource()}`);
          return { success: true, message: 'slow ran' };
        }),
        command('quick', async () => {
          sources.push(`quick:${router.getCommandInvocationSource()}`);
          return { success: true, message: 'quick ran' };
        }),
      ],
      withScope,
    );

    const slow = router.executeCommand('slow', '', 'user');
    const quick = await router.executeCommand('quick', '', 'remote');
    held.open();
    await slow;

    expect(quick).toMatchObject({ success: true, message: 'quick ran' });
    expect(sources).toEqual(['quick:remote', 'slow:user']);
  });
});
