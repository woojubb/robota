import { afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

import type { ICommandModule } from '../../command-api/command-module.js';
import type { IInteractiveSessionEvents } from '@robota-sdk/agent-interface-session';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), 5_000);
    }),
  ]);
}

describe('interactive execution claim (framework functional)', () => {
  it(
    'keeps a queued prompt through public command refusal and settles it exactly once',
    async () => {
      const commandExecute = vi.fn().mockResolvedValue({ success: true, message: 'must not run' });
      const blockingCommandModule: ICommandModule = {
        name: 'execution-claim-test',
        systemCommands: [
          {
            name: 'blocked-command',
            description: 'Must remain blocked while a prompt owns execution',
            lifecycle: 'blocking',
            execute: commandExecute,
          },
        ],
      };
      harness = scriptedSession({
        permissionMode: 'default',
        commandModules: [blockingCommandModule],
        turns: [
          {
            toolCalls: [
              { name: 'Bash', args: { command: 'echo denied > {{cwd}}/must-not-exist.txt' } },
            ],
          },
          { text: 'FIRST_DONE' },
          { text: 'QUEUED_DONE' },
        ],
      });
      const permissionRequest = new Promise<{ id: string }>((resolve) => {
        harness!.session.on('permission_request', ((event: { id: string }) =>
          resolve(event)) as IInteractiveSessionEvents['permission_request']);
      });
      const thinkingStates: boolean[] = [];
      harness.session.on('thinking', (thinking) => thinkingStates.push(thinking));

      const firstSubmission = harness.session.submit('first prompt');
      const permission = await bounded(permissionRequest, 'permission request');
      const queued = await harness.session.submit('queued prompt');
      let queuedSettlements = 0;
      void queued.completed.then(
        () => {
          queuedSettlements += 1;
        },
        () => {
          queuedSettlements += 1;
        },
      );
      const thinkingBeforeCommand = [...thinkingStates];

      const blocked = await bounded(
        harness.session.executeCommand('blocked-command', ''),
        'public command refusal',
      );

      expect(blocked).toMatchObject({ success: false });
      expect(blocked?.message).toMatch(/already running/i);
      expect(commandExecute).not.toHaveBeenCalled();
      expect(thinkingStates).toEqual(thinkingBeforeCommand);
      expect(harness.session.getPendingPrompt()).toBe('queued prompt');

      harness.session.resolvePermission(permission.id, false);
      const first = await bounded(firstSubmission, 'first submission');
      await expect(bounded(first.completed, 'first turn')).resolves.toMatchObject({
        response: 'FIRST_DONE',
      });
      await expect(bounded(queued.completed, 'queued turn')).resolves.toMatchObject({
        response: 'QUEUED_DONE',
      });

      expect(queuedSettlements).toBe(1);
      expect(harness.session.getPendingPrompt()).toBeNull();
      expect(harness.exists('must-not-exist.txt')).toBe(false);
      expect(JSON.stringify(harness.session.getFullHistory())).not.toContain('SessionBusyError');
    },
    TEST_TIMEOUT,
  );
});
