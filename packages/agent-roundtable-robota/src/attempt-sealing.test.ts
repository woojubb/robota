import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';
import { FunctionTool, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { IAIProvider, TExecutionJournalRecord } from '@robota-sdk/agent-core';
import type { ParticipantTurn, TurnServices } from '@robota-sdk/agent-roundtable';
import { sessionParticipant } from './session-participant';
import type { RecoveryJournal, RecoveryJournalEntry } from './recovery-journal';

afterEach(() => {
  clearRegisteredToolProfiles();
});

const services: TurnServices = {
  admitModelCall: async () => {},
  admitToolEffect: async () => {},
  recordUsage: async () => {},
};

const turn: ParticipantTurn = {
  conversationId: 'room',
  participantId: 'solo',
  turnId: 't1',
  attemptId: 'a1',
  groupId: 'g1',
  context: { baseRevision: 0, messages: [] },
};

function attested(turns: readonly TScriptedTurn[]): IAIProvider {
  const scripted = createScriptedProvider(turns);
  return {
    ...scripted.provider,
    chat: async (messages, options) => {
      const reply = await scripted.provider.chat(messages, options);
      return { ...reply, metadata: { ...reply.metadata, usageProvenance: 'complete' } };
    },
  };
}

/** A durable journal that lets a test act the moment an entry is written. */
function journalOf(onWritten: (entry: RecoveryJournalEntry) => void) {
  const entries: RecoveryJournalEntry[] = [];
  const journal: RecoveryJournal = {
    durability: 'durable',
    append: async (entry) => {
      entries.push(structuredClone(entry));
      onWritten(entry);
    },
    read: async () => structuredClone(entries),
  };
  return { entries, journal };
}

const records = (entries: readonly RecoveryJournalEntry[]): TExecutionJournalRecord[] =>
  entries.flatMap((entry) => (entry.kind === 'record' ? [entry.record] : []));

function participantOver(
  journal: RecoveryJournal,
  provider: IAIProvider,
  pay: () => Promise<string>,
  permissions: { allow: string[]; ask: string[] } = { allow: ['pay'], ask: [] },
) {
  const tool = new FunctionTool(
    { name: 'pay', description: 'Pays', parameters: { type: 'object', properties: {} } },
    pay,
  );
  return sessionParticipant({
    id: 'solo',
    runtime: { id: 'seal/session', version: '1' },
    recovery: { journal: () => journal },
    createSessionOptions: async () => ({
      cwd: process.cwd(),
      hookTypeExecutors: [],
      tools: [tool],
      provider,
      systemMessage: 'Seal host',
      model: 'test-model',
      autoCompactThreshold: false,
      permissions: { ...permissions, deny: [] },
    }),
  });
}

describe('a turn the Session finished', () => {
  it('is journaled and returned when the stop was only observed while its last text was delivered', async () => {
    const stop = new AbortController();
    const { entries, journal } = journalOf(() => {});
    let delivered = 0;
    const participant = participantOver(journal, attested([{ text: 'done' }]), async () => 'paid');
    const lease = await participant.factory.openSession({
      conversationId: 'room',
      participantId: 'solo',
    });
    const outcome = await lease.session.runTurn(turn, {
      signal: stop.signal,
      // The core refuses a delta once the run has stopped; here the stop lands as the text is handed over.
      onDelta: async () => {
        delivered++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        stop.abort();
        stop.signal.throwIfAborted();
      },
      services,
    });
    expect(delivered).toBeGreaterThan(0);
    expect(stop.signal.aborted).toBe(true);
    expect(outcome).toEqual({ kind: 'speak', content: 'done' });
    expect(entries.findLast((entry) => entry.kind === 'turn-end')).toMatchObject({
      kind: 'turn-end',
      attemptId: 'a1',
      outcome: { kind: 'speak', content: 'done' },
    });
    await lease.release();
  });
});

describe('a stopped run', () => {
  it('journals nothing its Session writes while unwinding, so no result stands for a call it cancelled', async () => {
    const stop = new AbortController();
    const { entries, journal } = journalOf((entry) => {
      if (entry.kind === 'record' && entry.record.kind === 'tool-intent')
        stop.abort(new Error('stopped'));
    });
    const participant = participantOver(
      journal,
      attested([{ toolCalls: [{ name: 'pay', args: {} }] }, { text: 'done' }]),
      async () => 'paid',
    );
    const lease = await participant.factory.openSession({
      conversationId: 'room',
      participantId: 'solo',
    });
    await expect(
      lease.session.runTurn(turn, { signal: stop.signal, onDelta: async () => {}, services }),
    ).rejects.toThrow('stopped');
    const kinds = records(entries).map((record) => record.kind);
    expect(kinds).toContain('tool-intent');
    expect(kinds).not.toContain('tool-result');
    expect(kinds).not.toContain('tool-effect-start');
    expect(entries.some((entry) => entry.kind === 'turn-end')).toBe(false);
    await lease.release();
  });
});
