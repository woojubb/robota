import { describe, expect, it, vi } from 'vitest';
import { wrapWorkflowWriteApproval } from './workflow-write-approval.js';
import type { ICommandHostContext, ISystemCommand } from '@robota-sdk/agent-framework';

function host(source: 'user' | 'model' | 'remote', answer?: 'yes' | 'no'): ICommandHostContext {
  return {
    getCommandInvocationSource: () => source,
    getUserInteraction: () =>
      answer === undefined
        ? undefined
        : {
            ask: vi.fn(async () => ({ type: 'answer' as const, values: [answer] })),
          },
  } as ICommandHostContext;
}

describe('workflow write approval', () => {
  it('requires a human confirmation for create and closes its grant after execution', async () => {
    const execute = vi.fn(async () => ({ success: true, message: 'saved' }));
    const close = vi.fn();
    const approve = vi.fn(() => ({}));
    const command = wrapWorkflowWriteApproval(
      { name: 'workflows', execute: vi.fn() } as unknown as ISystemCommand,
      () => ({ approve, close }),
      execute,
    );
    expect((await command.execute(host('user', 'no'), 'create example')).success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect((await command.execute(host('user', 'yes'), 'create example')).success).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('does not turn missing interaction or a model invocation into approval', async () => {
    const execute = vi.fn(async () => ({ success: true, message: 'saved' }));
    const command = wrapWorkflowWriteApproval(
      { name: 'workflows', execute: vi.fn() } as unknown as ISystemCommand,
      () => ({ approve: vi.fn(() => ({})), close: vi.fn() }),
      execute,
    );
    expect((await command.execute(host('user'), 'build example')).success).toBe(false);
    expect((await command.execute(host('model', 'yes'), 'create example')).success).toBe(false);
    expect((await command.execute(host('remote'), 'build example')).success).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
  it('lets a remote desktop user approve the operation through an interactive client', async () => {
    const execute = vi.fn(async () => ({ success: true, message: 'saved' }));
    const command = wrapWorkflowWriteApproval(
      { name: 'workflows', execute: vi.fn() } as unknown as ISystemCommand,
      () => ({ approve: () => ({}), close: vi.fn() }),
      execute,
    );
    expect((await command.execute(host('remote', 'yes'), 'build example')).success).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });
  it('preserves the ordinary read-only command path', async () => {
    const original = vi.fn(async () => ({ success: true, message: 'listed' }));
    const prepare = vi.fn();
    const command = wrapWorkflowWriteApproval(
      { name: 'workflows', execute: original } as unknown as ISystemCommand,
      prepare,
      vi.fn(),
    );
    expect((await command.execute(host('user'), 'list')).message).toBe('listed');
    expect(prepare).not.toHaveBeenCalled();
  });
  it('closes the approval even when the workflow command fails', async () => {
    const close = vi.fn();
    const command = wrapWorkflowWriteApproval(
      { name: 'workflows', execute: vi.fn() } as unknown as ISystemCommand,
      () => ({ approve: () => ({}), close }),
      async () => {
        throw new Error('workflow failed');
      },
    );
    await expect(command.execute(host('user', 'yes'), 'create example')).rejects.toThrow(
      'workflow failed',
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
