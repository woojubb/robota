import { expect, it, vi } from 'vitest';
import { SessionSkillRouter } from '../interactive-session-skill-router.js';
import { createTestCommandHost } from '../../testing/command-host-double.js';
import { stubSubmit } from './helpers/session-stub.js';
import type { ICommand } from '../../command-api/types.js';

function fixture(runFork?: () => Promise<string>) {
  const read = vi.fn(async (uri: string, _signal?: AbortSignal) => ({
    uri,
    text: 'Verified supporting bytes',
    digest: 'sha256:verified',
    size: 25,
  }));
  const activation = {
    content: 'Verified workflow',
    resources: {
      manifest: [{ uri: 'skill://remote/reference.txt', digest: 'sha256:verified', size: 25 }],
      read,
    },
    validate: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const acquire = vi.fn(async (_signal?: AbortSignal) => activation);
  const skill: ICommand = {
    name: 'remote',
    source: 'host-skill',
    description: 'Run a workflow',
    skillContentLoader: { acquire },
  };
  const router = new SessionSkillRouter(
    [],
    [],
    [],
    undefined,
    () => createTestCommandHost(),
    () => 'session',
    stubSubmit,
    async () => undefined,
    () => undefined,
    async () => (runFork ? runFork() : ''),
    async () => ({ mode: 'fork' }),
    (execute) => execute(),
  );
  return { activation, acquire, skill, router, read };
}

it('reads supporting resources only after activation and only in its owning turn', async () => {
  const f = fixture();
  await expect(
    f.router.readSkillResource('remote', 'skill://remote/reference.txt'),
  ).rejects.toThrow(/active/);
  expect(f.acquire).not.toHaveBeenCalled();
  f.router.beginTurnSkillActivation('a');
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  expect(await f.router.readSkillResource('remote', 'skill://remote/reference.txt')).toMatchObject({
    text: 'Verified supporting bytes',
  });
  f.router.endTurnSkillActivation('a');
  f.router.beginTurnSkillActivation('b');
  await expect(
    f.router.readSkillResource('remote', 'skill://remote/reference.txt'),
  ).rejects.toThrow(/active/);
  expect(f.read).toHaveBeenCalledOnce();
  f.router.endTurnSkillActivation('b');
});

it('refuses late supporting bytes after the owning turn ends even if a host ignores abort', async () => {
  const f = fixture();
  let release = () => {};
  let reached = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  f.read.mockImplementationOnce(async (uri) => {
    reached();
    await waiting;
    return { uri, text: 'Late bytes', digest: 'sha256:verified', size: 10 };
  });
  f.router.beginTurnSkillActivation('a');
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  const pending = f.router.readSkillResource('remote', 'skill://remote/reference.txt');
  await reading;
  f.router.endTurnSkillActivation('a');
  f.router.beginTurnSkillActivation('b');
  release();
  await expect(pending).rejects.toBeDefined();
  expect(f.read).toHaveBeenCalledOnce();
  f.router.endTurnSkillActivation('b');
});

it('refuses undeclared supporting resources without dispatch or new activation', async () => {
  const f = fixture();
  f.router.beginTurnSkillActivation('a');
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  await expect(f.router.readSkillResource('remote', 'file:///private/unapproved')).rejects.toThrow(
    /manifest/,
  );
  expect(f.read).not.toHaveBeenCalled();
  expect(f.acquire).toHaveBeenCalledOnce();
  f.router.endTurnSkillActivation('a');
});

it('binds fork supporting reads to that fork and withholds other parent activations', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(async () => {
    expect(
      await f.router.readSkillResource('forked', 'skill://remote/reference.txt'),
    ).toMatchObject({ text: 'Verified supporting bytes' });
    await expect(
      f.router.readSkillResource('remote', 'skill://remote/reference.txt'),
    ).rejects.toThrow(/active/);
    return 'fork completed';
  });
  f.router.beginTurnSkillActivation('parent');
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  const forkActivation = { ...f.activation, close: vi.fn() };
  f.acquire.mockResolvedValueOnce(forkActivation);
  await f.router.executeSkillWithActivation(
    { ...f.skill, name: 'forked', context: 'fork' },
    '',
    'model-tool',
  );
  expect(forkActivation.close).toHaveBeenCalledOnce();
  await expect(
    f.router.readSkillResource('forked', 'skill://remote/reference.txt'),
  ).rejects.toThrow(/active/);
  expect(await f.router.readSkillResource('remote', 'skill://remote/reference.txt')).toMatchObject({
    text: 'Verified supporting bytes',
  });
  f.router.endTurnSkillActivation('parent');
});

it('keeps an explicitly activated supporting skill inside the fork instead of transferring it to the parent', async () => {
  let f: ReturnType<typeof fixture>;
  const closeNested = vi.fn();
  f = fixture(async () => {
    f.acquire.mockResolvedValueOnce({ ...f.activation, close: closeNested });
    await f.router.executeSkillWithActivation({ ...f.skill, name: 'nested' }, '', 'model-tool');
    expect(
      await f.router.readSkillResource('nested', 'skill://remote/reference.txt'),
    ).toMatchObject({ text: 'Verified supporting bytes' });
    return 'fork completed';
  });
  f.router.beginTurnSkillActivation('parent');
  await f.router.executeSkillWithActivation({ ...f.skill, context: 'fork' }, '', 'model-tool');
  expect(closeNested).toHaveBeenCalledOnce();
  await expect(
    f.router.readSkillResource('nested', 'skill://remote/reference.txt'),
  ).rejects.toThrow(/active/);
  f.router.endTurnSkillActivation('parent');
});

it('closes model instruction activations with their own turn and ignores a stale completion', async () => {
  const f = fixture();
  f.router.beginTurnSkillActivation('a');
  expect((await f.router.executeSkillWithActivation(f.skill, '', 'model-tool')).prompt).toContain(
    'Verified workflow',
  );
  expect(f.activation.close).not.toHaveBeenCalled();
  expect(f.router.endTurnSkillActivation('a')).toEqual([]);
  expect(f.activation.close).toHaveBeenCalledOnce();
  f.router.beginTurnSkillActivation('b');
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  f.router.endTurnSkillActivation('a');
  expect(f.activation.close).toHaveBeenCalledOnce();
  f.router.endTurnSkillActivation('b');
  expect(f.activation.close).toHaveBeenCalledTimes(2);
});

it('refuses activation outside a model turn and closes the acquired window', async () => {
  const f = fixture();
  await expect(f.router.executeSkillWithActivation(f.skill, '', 'model-tool')).rejects.toThrow(
    /owning turn/,
  );
  expect(f.activation.close).toHaveBeenCalledOnce();
});

it('cancels an acquired window on abort and cannot transfer a late acquisition to the next turn', async () => {
  const f = fixture();
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.acquire.mockImplementationOnce(async () => {
    await waiting;
    return f.activation;
  });
  f.router.beginTurnSkillActivation('a');
  const pending = f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  f.router.abortSkillActivations();
  f.router.beginTurnSkillActivation('b');
  release();
  await expect(pending).rejects.toBeDefined();
  expect(f.activation.close).toHaveBeenCalledOnce();
  f.router.endTurnSkillActivation('b');
  expect(f.activation.close).toHaveBeenCalledOnce();
});

it('closes every activation even if one host close callback fails', async () => {
  const f = fixture();
  const second = { ...f.activation, close: vi.fn() };
  f.router.beginTurnSkillActivation('a');
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  f.acquire.mockResolvedValueOnce(second);
  await f.router.executeSkillWithActivation(f.skill, '', 'model-tool');
  f.activation.close.mockImplementationOnce(() => {
    throw new Error('close failed');
  });
  expect(f.router.endTurnSkillActivation('a')[0]?.message).toBe('close failed');
  expect(second.close).toHaveBeenCalledOnce();
});
