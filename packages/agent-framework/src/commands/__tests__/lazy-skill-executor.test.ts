import { expect, it, vi } from 'vitest';
import { executeSkill } from '../skill-executor.js';
import type { ICommand } from '../../command-api/types.js';

function fixture(context?: string) {
  const activation = {
    content: 'Verified instructions for $ARGUMENTS. !`touch /unapproved`',
    validate: vi.fn(async () => undefined),
    close: vi.fn(),
  };
  const acquire = vi.fn(async () => activation);
  const skill = {
    name: 'remote-demo',
    description: 'Follow a remote workflow',
    source: 'host-skill',
    ...(context ? { context } : {}),
    skillContentLoader: { acquire },
  } as ICommand;
  return { activation, acquire, skill };
}

it('keeps discovery metadata lazy and transfers verified instructions only to an owning turn', async () => {
  const f = fixture();
  expect(f.skill.description).toBe('Follow a remote workflow');
  expect(f.acquire).not.toHaveBeenCalled();
  const retainActivation = vi.fn();
  const result = await executeSkill(f.skill, 'argument', { retainActivation });
  expect(f.acquire).toHaveBeenCalledOnce();
  expect(result.prompt).toContain('Verified instructions for argument');
  expect(retainActivation).toHaveBeenCalledWith(f.activation);
  expect(f.activation.close).not.toHaveBeenCalled();
});

it('keeps remote shell expressions literal even when local shell preprocessing is available', async () => {
  const f = fixture();
  const shellExec = vi.fn(() => 'shell output');
  const result = await executeSkill(f.skill, '', { retainActivation: () => undefined, shellExec });
  expect(result.prompt).toContain('!`touch /unapproved`');
  expect(shellExec).not.toHaveBeenCalled();
});

it('refuses lazy injection without a turn owner and closes the acquired window', async () => {
  const f = fixture();
  await expect(executeSkill(f.skill, '', {})).rejects.toThrow(/owning turn/);
  expect(f.activation.close).toHaveBeenCalledOnce();
});

it('closes a fork window after execution failure and does not transfer it to another turn', async () => {
  const f = fixture('fork');
  const retainActivation = vi.fn();
  const runInFork = vi.fn(async () => {
    throw new Error('fork stopped');
  });
  await expect(executeSkill(f.skill, '', { retainActivation, runInFork })).rejects.toThrow(
    'fork stopped',
  );
  expect(runInFork).toHaveBeenCalledWith(
    expect.stringContaining('Verified instructions'),
    {},
    f.activation,
  );
  expect(f.activation.close).toHaveBeenCalledOnce();
  expect(retainActivation).not.toHaveBeenCalled();
});

it('revalidates consent before publishing processed instructions and closes refused windows', async () => {
  const f = fixture();
  f.activation.validate
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('consent withdrawn'));
  const retainActivation = vi.fn();
  await expect(executeSkill(f.skill, '', { retainActivation })).rejects.toThrow(
    'consent withdrawn',
  );
  expect(retainActivation).not.toHaveBeenCalled();
  expect(f.activation.close).toHaveBeenCalledOnce();
});

it('refuses a fork before it starts if consent changes while instructions are prepared', async () => {
  const f = fixture('fork');
  f.activation.validate
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('consent withdrawn'));
  const runInFork = vi.fn(async () => 'must not run');
  await expect(executeSkill(f.skill, '', { runInFork })).rejects.toThrow('consent withdrawn');
  expect(runInFork).not.toHaveBeenCalled();
  expect(f.activation.close).toHaveBeenCalledOnce();
});
