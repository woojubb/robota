import { expect, it, vi } from 'vitest';
import { InteractiveSession } from '../interactive-session.js';
import { publicTurnOptions } from '../interactive-session-turn-submission.js';
import { createSessionStub } from './helpers/session-stub.js';
import type { ICommand } from '../../command-api/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class SkillSession extends InteractiveSession {
  install(skill: ICommand) {
    this.skillRouter.replacePluginSkills([skill]);
  }
  runSkill(skill: ICommand) {
    return this.skillRouter.executeUserResolvedSkillCommand(
      skill,
      'task',
      '/remote task',
      '/remote task',
      'user-slash',
      'guest',
    );
  }
}

function fixture() {
  const started = deferred<void>();
  const finish = deferred<string>();
  const run = vi
    .fn(async () => 'finished')
    .mockImplementationOnce(async () => {
      started.resolve();
      return finish.promise;
    });
  const parent = createSessionStub({
    run,
    getEventService: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getModelEffort: () => 'low',
    getModelId: () => 'test-model',
    getPermissionMode: () => 'default',
  } as never);
  const session = new SkillSession({ session: parent, cwd: process.cwd() });
  const activation = {
    content: 'Verified $ARGUMENTS',
    validate: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const acquire = vi.fn(async (_signal?: AbortSignal) => activation);
  const skill: ICommand = {
    name: 'remote',
    source: 'host-skill',
    description: 'Run the approved workflow',
    skillContentLoader: { acquire },
  };
  session.install(skill);
  return { session, skill, run, started, finish, activation, acquire };
}

it('loads a queued user skill only inside its executing turn and closes it before that turn completes', async () => {
  const f = fixture();
  const first = f.session.submit('hold');
  await f.started.promise;
  const queued = await f.session.runSkill(f.skill);
  expect(queued.mode).toBe('inject');
  expect(f.acquire).not.toHaveBeenCalled();
  const completed = new Promise<void>((resolve) =>
    f.session.on('complete', () => {
      if (f.run.mock.calls.length === 2) resolve();
    }),
  );
  f.finish.resolve('first');
  await first;
  await completed;
  expect(f.acquire).toHaveBeenCalledOnce();
  expect(f.run).toHaveBeenLastCalledWith(
    expect.stringContaining('Verified task'),
    '/remote task',
    expect.objectContaining({ driverId: 'guest' }),
  );
  expect(f.activation.close).toHaveBeenCalledOnce();
});

it('cancelling the queued skill does not acquire instructions', async () => {
  const f = fixture();
  const first = f.session.submit('hold');
  await f.started.promise;
  await f.session.runSkill(f.skill);
  f.session.cancelQueue();
  f.finish.resolve('first');
  await first;
  expect(f.acquire).not.toHaveBeenCalled();
  expect(f.run).toHaveBeenCalledOnce();
});

it('does not carry a caller-supplied preparation callback across the public submission boundary', () => {
  const preparePrompt = vi.fn();
  expect(publicTurnOptions({ driverId: 'guest', preparePrompt } as never)).toEqual({
    driverId: 'guest',
  });
  expect(preparePrompt).not.toHaveBeenCalled();
});

it('rechecks consent after turn preparation and refuses the provider call when it was withdrawn', async () => {
  const f = fixture();
  f.activation.validate
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('consent withdrawn before dispatch'));
  await expect(f.session.runSkill(f.skill)).rejects.toThrow('consent withdrawn before dispatch');
  expect(f.run).not.toHaveBeenCalled();
  expect(f.activation.close).toHaveBeenCalledOnce();
});

it('aborting a pending lazy fork cancels its acquisition and closes the returned activation', async () => {
  const f = fixture();
  const started = deferred<AbortSignal>();
  const loaded = deferred<typeof f.activation>();
  f.acquire.mockImplementationOnce(async (signal) => {
    started.resolve(signal!);
    return loaded.promise;
  });
  const pending = f.session.runSkill({ ...f.skill, context: 'fork' });
  const signal = await started.promise;
  f.session.abort();
  expect(signal.aborted).toBe(true);
  loaded.resolve(f.activation);
  await expect(pending).resolves.toMatchObject({ mode: 'fork', result: '' });
  expect(f.activation.close).toHaveBeenCalledOnce();
  expect(f.run).not.toHaveBeenCalled();
});
