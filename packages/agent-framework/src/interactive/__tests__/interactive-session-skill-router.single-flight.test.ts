import { describe, expect, it, vi } from 'vitest';

import { SessionSkillRouter } from '../interactive-session-skill-router.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { stubSubmit } from './helpers/session-stub.js';

import type { ICommand } from '../../command-api/types.js';
import type { ICommandModule, ISystemCommand } from '../../commands/index.js';
import type { IFrameworkHost } from '../../host/framework-host.js';
import type { TDriverId } from '@robota-sdk/agent-interface/session';

/**
 * A host with no `createAsyncScope` (a browser) cannot give each command a scope that follows its own
 * call chain, so the router stays strictly nested. It runs one user or remote command at a time and
 * says so to a second. It admits a model command only when no such command runs, or when that command
 * has started its own turn; any other would sit on top of the one slot a user command reads after an
 * await, and hand it the model's source and locality. A host that has a scope keeps today's behaviour:
 * every command sees its own.
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

interface IRouterHooks {
  /** What the turn a user command starts does; the turn is where its model commands run. */
  readonly runTurn?: () => Promise<void>;
}

function makeRouter(
  commands: ISystemCommand[],
  createAsyncScope: IFrameworkHost['createAsyncScope'],
  hooks: IRouterHooks = {},
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
    async (...args) => {
      await hooks.runTurn?.();
      return stubSubmit(...args);
    },
    async () => {},
    () => {},
    async () => '',
    async () => ({}) as never,
    (execute) => execute(),
    createAsyncScope,
    undefined,
    undefined,
    [],
    async () => {
      await hooks.runTurn?.();
    },
  );
}

const REFUSAL = /Another command is already running/;
const REMOTE_DRIVER = 'driver-1' as TDriverId;

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

  it('lets model commands overlap when no user or remote command runs, each reading the model scope', async () => {
    const held = gate();
    const sources: string[] = [];
    let router: SessionSkillRouter;
    router = makeRouter(
      [
        command(
          'lookup',
          async () => {
            await held.wait;
            sources.push(
              `${router.getCommandInvocationSource()}:${router.getCommandSurfaceLocality()}`,
            );
            return { success: true, message: 'looked up' };
          },
          { modelInvocable: true },
        ),
      ],
      withoutScope,
    );

    const parallel = [
      router.executeModelCommand('lookup', ''),
      router.executeModelCommand('lookup', ''),
    ];
    held.open();
    await Promise.all(parallel);

    expect(sources).toEqual(['model:local', 'model:local']);
  });

  it('turns a model command away while a remote command that has started no turn is mid-await, so that command keeps its own scope', async () => {
    const held = gate();
    const reads: Array<{ source: string; driver: unknown; locality: string; evidence: unknown }> =
      [];
    const lookup = vi.fn(async () => ({ success: true, message: 'looked up' }));
    let router: SessionSkillRouter;
    router = makeRouter(
      [
        command('effort', async () => {
          await held.wait;
          reads.push({
            source: router.getCommandInvocationSource(),
            driver: router.getCommandOriginDriverId(),
            locality: router.getCommandSurfaceLocality(),
            evidence: router.getCommandSurfaceLocalityEvidence(),
          });
          return { success: true, message: 'effort set' };
        }),
        command('lookup', lookup, { modelInvocable: true }),
      ],
      withoutScope,
    );

    const remote = router.executeCommand('effort', '', 'remote', REMOTE_DRIVER, 'remote');
    const refused = await router.executeModelCommand('lookup', '');
    held.open();
    await remote;

    expect(refused).toMatchObject({ success: false, message: expect.stringMatching(REFUSAL) });
    expect(lookup).not.toHaveBeenCalled();
    // After the await it still reads the remote driver and locality it was started with.
    expect(reads).toEqual([
      { source: 'remote', driver: REMOTE_DRIVER, locality: 'remote', evidence: 'remote' },
    ]);
  });

  describe.each([
    ['an inline skill', false],
    ['a lazily loaded skill', true],
  ])('the turn %s starts', (_name, lazy) => {
    const skill: ICommand = {
      name: 'review',
      source: 'host-skill',
      description: 'Review the change',
      ...(lazy ? { skillContentLoader: { acquire: async () => ({}) as never } } : {}),
    };

    it('runs its model commands, which read the model scope, while the command reads its own before and after', async () => {
      const afterTurn = gate();
      const reachedAfterTurn = gate();
      const sources: string[] = [];
      let router: SessionSkillRouter;
      const turn = async (): Promise<void> => {
        // The turn's model calls a command; the command that started the turn waits on it.
        await router.executeModelCommand('lookup', '');
      };
      router = makeRouter(
        [
          command(
            'lookup',
            async () => {
              sources.push(`lookup:${router.getCommandInvocationSource()}`);
              return { success: true, message: 'looked up' };
            },
            { modelInvocable: true },
          ),
          command('skill', async () => {
            sources.push(`before:${router.getCommandInvocationSource()}`);
            await router.executeUserResolvedSkillCommand(
              skill,
              '',
              'review',
              '/review',
              'user-slash',
            );
            sources.push(`after:${router.getCommandInvocationSource()}`);
            reachedAfterTurn.open();
            await afterTurn.wait;
            return { success: true, message: 'skill done' };
          }),
        ],
        withoutScope,
        { runTurn: turn },
      );

      const running = router.executeCommand('skill', '', 'user');
      await reachedAfterTurn.wait;
      // The turn is over: the command is mid-await again, and a model command no longer belongs to it.
      expect(await router.executeModelCommand('lookup', '')).toMatchObject({
        success: false,
        message: expect.stringMatching(REFUSAL),
      });
      afterTurn.open();
      await running;

      expect(sources).toEqual(['before:user', 'lookup:model', 'after:user']);
    });
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

  it('answers a model command that arrives mid-remote-command, which keeps its own driver and locality', async () => {
    const held = gate();
    const reads: Array<{ source: string; driver: unknown; locality: string }> = [];
    let router: SessionSkillRouter;
    router = makeRouter(
      [
        command('effort', async () => {
          await held.wait;
          reads.push({
            source: router.getCommandInvocationSource(),
            driver: router.getCommandOriginDriverId(),
            locality: router.getCommandSurfaceLocality(),
          });
          return { success: true, message: 'effort set' };
        }),
        command(
          'lookup',
          async () => {
            reads.push({
              source: router.getCommandInvocationSource(),
              driver: router.getCommandOriginDriverId(),
              locality: router.getCommandSurfaceLocality(),
            });
            return { success: true, message: 'looked up' };
          },
          { modelInvocable: true },
        ),
      ],
      withScope,
    );

    const remote = router.executeCommand('effort', '', 'remote', REMOTE_DRIVER, 'remote');
    expect(await router.executeModelCommand('lookup', '')).toMatchObject({ success: true });
    held.open();
    await remote;

    expect(reads).toEqual([
      { source: 'model', driver: undefined, locality: 'local' },
      { source: 'remote', driver: REMOTE_DRIVER, locality: 'remote' },
    ]);
  });
});
