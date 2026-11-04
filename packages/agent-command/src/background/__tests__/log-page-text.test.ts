/**
 * #3679 step 3b: how `/agent read` (model-invocable) and `/background read` show a log page whose
 * records are sealed. The page's lines already hold a fixed placeholder for what could not be opened;
 * the command says why, names "unlock" only where an unlock would help, and never says there are no
 * log lines while records exist. A plain page is its lines, with nothing added.
 */
import { describe, expect, it } from 'vitest';

import { executeAgentCommand } from '../../agent/agent-command.js';
import { createAgentSystemCommand } from '../../agent/agent-command-module.js';
import { executeBackgroundCommand } from '../background-command.js';
import { createBackgroundCommandModule } from '../background-command-module.js';

import type {
  IAgentJobHostContext,
  ICommandHostBackgroundTasks,
  ICommandHostContext,
} from '@robota-sdk/agent-framework';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
} from '@robota-sdk/agent-interface-execution';

type TPageFor = (taskId: string, cursor?: IBackgroundTaskLogCursor) => IBackgroundTaskLogPage;

/** The text each of the two commands shows for the page `pageFor` answers. */
async function shown(
  args: string,
  pageFor: TPageFor,
): Promise<{ agent: string; background: string }> {
  const readBackgroundTaskLog = async (taskId: string, cursor?: IBackgroundTaskLogCursor) =>
    pageFor(taskId, cursor);
  const agent = await executeAgentCommand(
    { readBackgroundTaskLog } as unknown as IAgentJobHostContext,
    `read ${args}`,
  );
  const background = await executeBackgroundCommand(
    { readBackgroundTaskLog } as unknown as ICommandHostBackgroundTasks,
    `read ${args}`,
  );
  return { agent: agent.message, background: background.message };
}

describe('a log page as /agent read and /background read show it', () => {
  it('reads a plain page as its lines', async () => {
    const { agent, background } = await shown('agent_1 0', (taskId, cursor) => ({
      taskId,
      cursor,
      nextCursor: { offset: 200 },
      lines: ['{"event":"a"}', '{"event":"b"}'],
    }));

    expect(agent).toBe('{"event":"a"}\n{"event":"b"}\nNext offset: 200');
    expect(background).toBe(agent);
  });

  it('says an unlock reads the records the locked keys hold back', async () => {
    const { agent, background } = await shown('agent_1', (taskId) => ({
      taskId,
      lines: ['{"event":"a"}', '[3 sealed log records; the keys are locked]'],
      unreadable: { locked: 3, noKeys: 0, doesNotOpen: 0 },
    }));

    expect(agent).toBe(
      '{"event":"a"}\n[3 sealed log records; the keys are locked]\n' +
        '3 sealed records on this page are locked; unlock to read them.',
    );
    expect(background).toBe(agent);
  });

  it('names /unlock for locked records where the session registered it', async () => {
    const readBackgroundTaskLog = async (taskId: string) => ({
      taskId,
      lines: ['[2 sealed log records; the keys are locked]'],
      unreadable: { locked: 2, noKeys: 0, doesNotOpen: 0 },
    });
    const context = {
      readBackgroundTaskLog,
      getAgentJobCapability: () => ({ readBackgroundTaskLog }),
      listCommands: () => [
        { name: 'unlock', description: 'Unlock', modelInvocable: false, runner: 'runtime' },
      ],
    } as unknown as ICommandHostContext;
    const background = createBackgroundCommandModule().systemCommands?.find(
      (command) => command.name === 'background',
    );

    const agent = await createAgentSystemCommand().execute(context, 'read agent_1');
    const shownByBackground = await background?.execute(context, 'read agent_1');

    const hint = '2 sealed records on this page are locked; run `/unlock` to read them.';
    expect(agent.message.split('\n').at(-1)).toBe(hint);
    expect(shownByBackground?.message.split('\n').at(-1)).toBe(hint);
  });

  it('says this process has no keys to open them, and nothing about unlocking', async () => {
    const { agent } = await shown('agent_1', (taskId) => ({
      taskId,
      lines: ['[1 sealed log record; this process has no keys to open it]'],
      unreadable: { locked: 0, noKeys: 1, doesNotOpen: 0 },
    }));

    expect(agent).toBe(
      '[1 sealed log record; this process has no keys to open it]\n' +
        '1 sealed record on this page cannot be read: this process has no keys to open it.',
    );
    expect(agent).not.toMatch(/unlock/i);
  });

  it('counts the records that do not open, apart from locked ones', async () => {
    const { agent } = await shown('agent_1', (taskId) => ({
      taskId,
      lines: [
        '[a sealed log record here does not open]',
        '[2 sealed log records; the keys are locked]',
      ],
      unreadable: { locked: 2, noKeys: 0, doesNotOpen: 1 },
    }));

    expect(agent.split('\n').slice(2)).toEqual([
      '2 sealed records on this page are locked; unlock to read them.',
      '1 record on this page does not open: it is damaged, or sealed with other keys or by a newer build.',
    ]);
  });

  it('still says there are no log lines for an empty log', async () => {
    const { agent, background } = await shown('agent_1', (taskId) => ({ taskId, lines: [] }));

    expect(agent).toBe('No log lines: agent_1');
    expect(background).toBe('No log lines: agent_1');
  });
});

/**
 * Every build before #3679 step 3b, kept verbatim as the golden reference: the page a plain log gave
 * (`createBackgroundTaskLogPage`), and the text both commands made of it.
 */
function pagePre3b(
  taskId: string,
  lines: readonly string[] | undefined,
  cursor?: IBackgroundTaskLogCursor,
): IBackgroundTaskLogPage {
  if (lines === undefined) return { taskId, cursor, lines: [] };
  const offset = cursor?.offset ?? 0;
  const nextOffset = Math.min(offset + 200, lines.length);
  return {
    taskId,
    cursor,
    nextCursor: nextOffset < lines.length ? { offset: nextOffset } : undefined,
    lines: lines.slice(offset, nextOffset),
  };
}

function textPre3b(taskId: string, page: IBackgroundTaskLogPage): string {
  const next = page.nextCursor ? `\nNext offset: ${page.nextCursor.offset}` : '';
  return page.lines.length > 0 ? `${page.lines.join('\n')}${next}` : `No log lines: ${taskId}`;
}

describe('a plain log reads as its lines #3679 step 3b', () => {
  const log = Array.from({ length: 450 }, (_, index) => `{"event":"e${index}"}`);

  it.each(['0', '1', '199', '200', '449', '450', '455', '-5', 'later', undefined])(
    'at offset %s, and for a task with no log',
    async (offset) => {
      for (const lines of [log, undefined]) {
        const pageFor: TPageFor = (taskId, cursor) => pagePre3b(taskId, lines, cursor);
        const { agent, background } = await shown(
          offset === undefined ? 'agent_1' : `agent_1 ${offset}`,
          pageFor,
        );
        const agentCursor =
          offset === undefined ? undefined : { offset: Number.parseInt(offset, 10) };
        const backgroundCursor = Number.isNaN(agentCursor?.offset) ? undefined : agentCursor;
        expect(agent).toBe(textPre3b('agent_1', pageFor('agent_1', agentCursor)));
        expect(background).toBe(textPre3b('agent_1', pageFor('agent_1', backgroundCursor)));
      }
    },
  );
});
