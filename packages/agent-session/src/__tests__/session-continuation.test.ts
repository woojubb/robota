import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRegisteredToolProfiles,
  FunctionTool,
  registerToolPermissionProfile,
} from '@robota-sdk/agent-core';
import { createScriptedProvider, type TScriptedTurn } from '@robota-sdk/agent-core/testing';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import { Session } from '../session.js';
import { FileSessionLogger } from '../session-logger.js';
import { loadSessionLogEntries, replaySessionLogEntries } from '../session-log-replay.js';
import type { ISessionOptions } from '../session-types.js';

const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
  clearRegisteredToolProfiles();
});
const action: TScriptedTurn = { toolCalls: [{ name: 'act', args: {} }] };
function fixture(turns: TScriptedTurn[], options: Partial<ISessionOptions> = {}) {
  const scripted = createScriptedProvider(turns);
  const effect = vi.fn(async () => 'effect result');
  const session = new Session({
    cwd: '/tmp',
    sessionId: 'recovered-session',
    systemMessage: 'Fixture',
    model: 'test-model',
    provider: scripted.provider,
    autoCompactThreshold: false,
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    tools: [
      new FunctionTool(
        { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
        effect,
      ),
    ],
    permissions: { allow: [], deny: [], ask: ['act'] },
    permissionHandler: async () => true,
    ...options,
  });
  sessions.push(session);
  return { session, effect, ...scripted };
}
async function stopped(peerTurn = false) {
  const source = fixture([action, { text: 'original answer' }]);
  const records: TExecutionJournalRecord[] = [];
  await expect(
    source.session.run('original input', undefined, {
      peerTurn,
      executionJournal: {
        append: async (record) => {
          records.push(structuredClone(record));
          if (record.kind === 'model-response') throw new Error('lost response acknowledgement');
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
  const journal = {
    read: vi.fn(async () => structuredClone(records)),
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      records.push(structuredClone(record));
    }),
  };
  return { source, records, journal, executionId: records[0].executionId };
}

describe('Session execution continuation', () => {
  it('replays the complete recovered history through the ordinary session-log codec', async () => {
    const saved = await stopped();
    const chunks: string[] = [];
    const sessionLogger = new FileSessionLogger({
      append: (_sessionId, text) => {
        chunks.push(text);
      },
    });
    const fresh = fixture([{ text: 'resumed answer' }], { sessionLogger });
    await fresh.session.resume(saved);
    sessionLogger.flush();
    const entries = loadSessionLogEntries({ readText: () => chunks.join('') });
    const replayed = replaySessionLogEntries(entries);
    expect(replayed.messages).toEqual(fresh.session.getHistory());
    expect(entries.filter((entry) => entry.event === 'user')).toHaveLength(0);
    expect(entries.filter((entry) => entry.event === 'provider_request')).toHaveLength(1);
  });

  it('uses current permission denial for unstarted actions without a new user input', async () => {
    const saved = await stopped();
    const approval = vi.fn(async () => false);
    const fresh = fixture([{ text: 'permission denied' }], { permissionHandler: approval });
    await expect(fresh.session.resume(saved)).resolves.toBe('permission denied');
    expect(approval).toHaveBeenCalledOnce();
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.session.getHistory().filter((message) => message.role === 'user')).toHaveLength(1);
    expect(fresh.requests).toHaveLength(1);
  });

  it('restores peer-turn authority and hosted-tool withholding from the owner checkpoint', async () => {
    registerToolPermissionProfile('act', { riskClass: 'modify', notInPeerTurn: true });
    const saved = await stopped(true);
    const fresh = fixture([{ text: 'peer completed' }], {
      permissions: { allow: ['act'], deny: [], ask: [] },
    });
    await expect(fresh.session.resume(saved)).resolves.toBe('peer completed');
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.chatOptions[0]?.nativeWebTools).toEqual({ webSearch: false, webFetch: false });
  });

  it.each(['missing', 'identity', 'scope', 'peer'])(
    'rejects incompatible owner state before effects (%s)',
    async (kind) => {
      const saved = await stopped(true);
      const request = saved.records.find((record) => record.kind === 'model-request')!;
      if (request.kind !== 'model-request') throw new Error('Missing request');
      if (kind === 'missing') delete request.checkpoint!.owner;
      if (kind === 'identity') request.checkpoint!.owner!.state.sessionId = 'another-session';
      if (kind === 'scope') request.checkpoint!.owner!.state.cwd = '/another-scope';
      if (kind === 'peer') request.checkpoint!.continuation!.options.withholdHostedTools = false;
      const fresh = fixture([{ text: 'must not call' }]);
      await expect(fresh.session.resume(saved)).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(fresh.requests).toHaveLength(0);
    },
  );

  it('holds its claim before journal reads and refuses overlapping run/resume calls', async () => {
    const saved = await stopped();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    saved.journal.read.mockImplementation(async () => {
      await gate;
      return structuredClone(saved.records);
    });
    const fresh = fixture([{ text: 'resumed' }]);
    const running = fresh.session.resume(saved);
    await expect(fresh.session.run('overlap')).rejects.toMatchObject({ name: 'SessionBusyError' });
    await expect(fresh.session.resume(saved)).rejects.toMatchObject({ name: 'SessionBusyError' });
    release();
    await expect(running).resolves.toBe('resumed');
    expect(fresh.effect).toHaveBeenCalledOnce();
  });

  it.each(['run', 'resume'] as const)(
    'drains a canceled %s before shutdown persists the final history',
    async (entry) => {
      const saved = await stopped();
      let release!: () => void;
      let enter!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const save = vi.fn();
      const fresh = fixture(
        entry === 'run' ? [action, { text: 'must not call' }] : [{ text: 'must not call' }],
        {
          sessionStore: {
            save,
            load: () => ({ status: 'missing' }),
            list: () => [],
            delete: () => {},
          },
        },
      );
      fresh.effect.mockImplementation(async () => {
        enter();
        await gate;
        return 'settled despite cancellation';
      });
      const running =
        entry === 'run' ? fresh.session.run('original input') : fresh.session.resume(saved);
      const canceled = expect(running).rejects.toMatchObject({ name: 'AbortError' });
      await entered;
      const closing = fresh.session.shutdown();
      await Promise.resolve();
      expect(save).not.toHaveBeenCalled();
      release();
      await canceled;
      await closing;
      expect(save).toHaveBeenCalledOnce();
      expect(
        save.mock.calls[0][0].messages.some((message: { role: string }) => message.role === 'tool'),
      ).toBe(true);
    },
  );
});
