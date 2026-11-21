import { describe, expect, it, vi } from 'vitest';
import type { IRecoverableExecutionJournal, TExecutionJournalRecord } from '@robota-sdk/agent-core';
import { sessionExecutionJournal, sessionRecoveryJournal } from '../session-execution-journal.js';

function fixture(peerTurn = false) {
  const records: TExecutionJournalRecord[] = [];
  const journal: IRecoverableExecutionJournal = {
    append: async (record) => void records.push(structuredClone(record)),
    read: async () => structuredClone(records),
  };
  const owner = {
    sessionId: 'session-one',
    cwd: '/workspace-one',
    peerTurn,
    canonicalizePath: (path: string) => path,
  };
  const frame: Extract<TExecutionJournalRecord, { kind: 'managed-frame' }> = {
    kind: 'managed-frame',
    recordId: 'call-one:frame',
    executionId: 'execution-one',
    callId: 'call-one',
    providerId: 'managed-provider',
    modelId: 'managed-model',
    response: {
      id: 'assistant-one',
      role: 'assistant',
      content: '',
      state: 'complete',
      timestamp: new Date('2026-01-01T00:00:01.000Z'),
      toolCalls: [
        {
          id: 'native-call-one',
          type: 'function',
          function: { name: 'act', arguments: '{}' },
        },
      ],
    },
    checkpoint: {
      version: 1,
      effectAdmission: 'required',
      messages: [
        {
          id: 'user-one',
          role: 'user',
          content: 'act',
          state: 'complete',
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      round: 1,
      contextLimit: 100_000,
      cumulativeInputTokens: 0,
      sameToolInputCounts: [],
      continuation: {
        version: 1,
        kind: 'round',
        startedAt: '2026-01-01T00:00:00.000Z',
        turnMessageId: 'user-one',
        model: { provider: 'managed-provider', model: 'managed-model' },
        structuredOutput: false,
        options: {
          maxExecutionRounds: 10,
          allowToolOnlyCompletion: false,
          withholdHostedTools: peerTurn,
        },
        toolsExecuted: [],
        consecutiveUnknownToolFailureRounds: 0,
      },
    },
    tools: [
      {
        name: 'act',
        description: 'Fixture action',
        parameters: { type: 'object', properties: {} },
      },
    ],
  };
  return { records, journal, owner, frame };
}

describe('Session ownership of managed journal frames', () => {
  it('preserves recoverable reads and stamps the same owner on managed frames', async () => {
    const f = fixture();
    const wrapped = sessionExecutionJournal(f.journal, f.owner);
    await wrapped.append(f.frame);
    if (!wrapped.read) throw new Error('Recoverable journal lost its read operation');
    expect((await wrapped.read('execution-one'))[0]).toMatchObject({
      kind: 'managed-frame',
      checkpoint: {
        owner: {
          kind: 'agent-session',
          version: 1,
          state: {
            sessionId: 'session-one',
            cwd: '/workspace-one',
            peerTurn: false,
            executionId: 'execution-one',
          },
        },
      },
    });
    expect(f.frame.checkpoint.owner).toBeUndefined();

    const appendOnly = sessionExecutionJournal({ append: async () => {} }, f.owner);
    expect('read' in appendOnly).toBe(false);
  });

  it('restores the owner and peer authority before allowing another managed append', async () => {
    const f = fixture(true);
    await sessionExecutionJournal(f.journal, f.owner).append(f.frame);
    const beginTurn = vi.fn();
    const recovery = sessionRecoveryJournal(
      f.journal,
      f.owner.sessionId,
      f.owner.cwd,
      beginTurn,
      f.owner.canonicalizePath,
    );
    const read = await recovery.read('execution-one');
    expect(read).toHaveLength(1);
    expect(beginTurn).toHaveBeenCalledExactlyOnceWith(true);
    const next = structuredClone(f.frame);
    next.recordId = 'call-two:frame';
    next.callId = 'call-two';
    next.response.id = 'assistant-two';
    next.response.toolCalls[0].id = 'native-call-two';
    await recovery.append(next);
    expect(f.records[1]).toMatchObject({
      kind: 'managed-frame',
      checkpoint: { owner: { state: { sessionId: 'session-one', peerTurn: true } } },
    });
  });

  it('rejects managed frames with conflicting peer authority in one execution', async () => {
    const f = fixture();
    await sessionExecutionJournal(f.journal, f.owner).append(f.frame);
    const next = structuredClone(f.frame);
    next.recordId = 'call-two:frame';
    next.callId = 'call-two';
    next.response.id = 'assistant-two';
    next.response.toolCalls[0].id = 'native-call-two';
    next.checkpoint.continuation!.options.withholdHostedTools = true;
    await sessionExecutionJournal(f.journal, { ...f.owner, peerTurn: true }).append(next);
    const beginTurn = vi.fn();
    const recovery = sessionRecoveryJournal(
      f.journal,
      f.owner.sessionId,
      f.owner.cwd,
      beginTurn,
      f.owner.canonicalizePath,
    );
    await expect(recovery.read('execution-one')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(beginTurn).not.toHaveBeenCalled();
  });

  it.each(['missing', 'session', 'scope', 'peer'] as const)(
    'rejects an incompatible %s owner before restoring authority',
    async (changed) => {
      const f = fixture();
      await sessionExecutionJournal(f.journal, f.owner).append(f.frame);
      const saved = f.records[0];
      if (saved?.kind !== 'managed-frame') throw new Error('Missing managed frame');
      if (changed === 'missing') delete saved.checkpoint.owner;
      if (changed === 'session') saved.checkpoint.owner!.state.sessionId = 'another-session';
      if (changed === 'scope') saved.checkpoint.owner!.state.cwd = '/another-workspace';
      if (changed === 'peer') {
        saved.checkpoint.owner!.state.peerTurn = true;
        saved.checkpoint.continuation!.options.withholdHostedTools = false;
      }
      const beginTurn = vi.fn();
      const recovery = sessionRecoveryJournal(
        f.journal,
        f.owner.sessionId,
        f.owner.cwd,
        beginTurn,
        f.owner.canonicalizePath,
      );
      await expect(recovery.read('execution-one')).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(beginTurn).not.toHaveBeenCalled();
      await expect(recovery.append(f.frame)).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(f.records).toHaveLength(1);
    },
  );
});
