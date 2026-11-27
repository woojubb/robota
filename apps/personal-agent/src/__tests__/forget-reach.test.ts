/**
 * Forgetting in the library reaches the saved conversations.
 *
 * The acceptance test reads raw bytes: after a forget, the fact is absent from every file of the wiki,
 * its log and both session stores (whatever its case, whitespace or JSON escaping), while every
 * message, id, timestamp and tool-call pairing survives and the record still loads.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileKnowledgeStore, KnowledgeWiki } from '@robota-sdk/agent-product/personal';
import { afterEach, describe, expect, it } from 'vitest';

import { createConversationForgetting } from '../conversation-forgetting.js';
import { createOwedRedactions } from '../owed-redactions.js';
import { createSideChatBook } from '../side-chats.js';
import { createPersonalGoalSessionStore, createPersonalSessionStore } from '../session-stores.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-framework';
import type { ILiveConversation } from '../conversation-forgetting.js';

const FACT = 'The vault code is 4471-ZETA';
const GONE = '[forgotten]';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forget-reach-'));
  dirs.push(dir);
  return dir;
}

function record(
  id: string,
  text: string,
  overrides: Partial<IInteractiveSessionRecord> = {},
): IInteractiveSessionRecord {
  const at = new Date('2026-09-01T00:00:00.000Z');
  return {
    id,
    name: `Chat ${id}`,
    cwd: '/work',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:01.000Z',
    messages: [
      {
        id: `${id}-1`,
        role: 'user',
        content: `Remember: ${text}.`,
        timestamp: at,
        state: 'complete',
      },
      {
        id: `${id}-2`,
        role: 'assistant',
        content: null,
        timestamp: at,
        state: 'complete',
        toolCalls: [
          {
            id: `${id}-call`,
            type: 'function',
            function: {
              name: 'WikiSearch',
              arguments: JSON.stringify({ query: text.toUpperCase().replace(/ /gu, '  ') }),
            },
          },
        ],
      },
      {
        id: `${id}-3`,
        role: 'tool',
        toolCallId: `${id}-call`,
        name: 'WikiSearch',
        content: `- ${text}\n  (claim)`,
        timestamp: at,
        state: 'complete',
      },
      { id: `${id}-4`, role: 'assistant', content: 'Noted.', timestamp: at, state: 'complete' },
    ],
    history: [
      {
        id: `${id}-h1`,
        timestamp: at,
        category: 'chat',
        type: 'user',
        data: { role: 'user', content: `Remember: ${text}.` },
      },
    ],
    systemPrompt: 'You are a personal assistant.',
    ...overrides,
  } as IInteractiveSessionRecord;
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

/** The way the matcher reads text: lower case, every whitespace run one space. */
const flat = (value: string): string => value.toLowerCase().replace(/\s+/gu, ' ');

function holders(dir: string, needle: string): string[] {
  const plain = flat(needle);
  const escaped = flat(JSON.stringify(needle).slice(1, -1));
  return filesUnder(dir).filter((file) => {
    const raw = flat(readFileSync(file, 'utf8'));
    // JSON-escaped newlines inside a file are whitespace to the matcher too.
    const spaced = raw.replace(/\\[nrt]/gu, ' ').replace(/\s+/gu, ' ');
    return [raw, spaced].some((text) => text.includes(plain) || text.includes(escaped));
  });
}

async function world(dir: string) {
  const sideChats = createSideChatBook(join(dir, 'side-chats'));
  const forgetting = createConversationForgetting({ stateDir: dir, sideChats });
  const wiki = new KnowledgeWiki({
    store: createFileKnowledgeStore(join(dir, 'wiki')),
    reach: forgetting.reach,
  });
  return {
    sideChats,
    forgetting,
    wiki,
    chats: createPersonalSessionStore(dir),
    goals: createPersonalGoalSessionStore(dir),
  };
}

describe('forgetting reaches the saved conversations', () => {
  it('removes the fact from the wiki, its log and both session stores, and every record still loads', async () => {
    const dir = stateDir();
    const { wiki, sideChats, chats, goals } = await world(dir);
    const filed = await wiki.remember({
      pageTitle: 'Home',
      kind: 'matter',
      claim: FACT,
      source: { origin: 'owner', sessionId: 'chat-source' },
    });
    await wiki.remember({
      pageTitle: 'Home',
      kind: 'matter',
      claim: 'The cat is called Tofu',
      source: { origin: 'owner' },
    });
    chats.save(record('chat-source', FACT));
    chats.save(record('chat-other', FACT.toLowerCase()));
    chats.save(record('chat-messenger', FACT, { name: 'Messenger: Mina' }));
    chats.save(record('chat-clean', 'something unrelated entirely'));
    goals.save(record('run-1', FACT.replace(/ /gu, '  ')));
    sideChats.add({ id: 'chat-source', title: FACT });
    sideChats.add({ id: 'chat-clean', title: 'Packing list for the ferry' });
    const before = chats.load('chat-source');
    expect(before.status).toBe('valid');

    // Files that must hold the fact before the forget, so the absence below proves something.
    expect(holders(dir, FACT).length).toBeGreaterThanOrEqual(6);

    const result = await wiki.forgetWithReport({ claimId: filed.claimId });
    expect(result.forgotten).toBe(1);
    expect(result.reachFailed).toBeUndefined();
    expect(result.conversations).toMatchObject({ cleaned: 4, pending: 0, notReached: 0 });
    expect(result.conversations?.sources).toEqual([`Chat chat-source`]);

    expect(holders(dir, FACT)).toEqual([]);
    // The other claim and the unrelated conversation are untouched.
    expect(readFileSync(join(dir, 'wiki', 'pages', 'home.md'), 'utf8')).toContain('Tofu');
    expect(sideChats.list().map((chat) => chat.title)).toEqual([
      'Packing list for the ferry',
      GONE,
    ]);

    for (const [store, id] of [
      [chats, 'chat-source'],
      [chats, 'chat-other'],
      [chats, 'chat-messenger'],
      [goals, 'run-1'],
    ] as const) {
      const loaded = store.load(id);
      expect(loaded.status).toBe('valid');
      if (loaded.status !== 'valid') continue;
      const saved = loaded.record;
      const original = record(id, FACT);
      // Every message, id, timestamp and tool-call pairing survives.
      expect(saved.messages.map((message) => message.id)).toEqual(
        original.messages.map((message) => message.id),
      );
      expect(saved.messages.map((message) => String(message.timestamp))).toEqual(
        original.messages.map((message) => String(message.timestamp)),
      );
      const call = saved.messages[1] as { toolCalls: { id: string }[] };
      const answer = saved.messages[2] as { toolCallId: string };
      expect(call.toolCalls[0]!.id).toBe(answer.toolCallId);
      expect(saved.messages[0]!.content).toBe(`Remember: ${GONE}.`);
      expect(saved.createdAt).toBe(original.createdAt);
    }
    // A record that held nothing was not written.
    expect(chats.load('chat-clean')).toMatchObject({ status: 'valid' });
  });

  it('writes nothing to a record another writer holds, one waiting on an execution, or one it cannot read', async () => {
    const dir = stateDir();
    const { wiki, chats, forgetting } = await world(dir);
    void forgetting;
    const filed = await wiki.remember({
      pageTitle: 'Home',
      kind: 'matter',
      claim: FACT,
      source: { origin: 'owner' },
    });
    chats.save(record('chat-held', FACT));
    chats.save(
      record('chat-parked', FACT, { pendingExecution: { executionId: 'e1', requests: [] } }),
    );
    chats.save(record('chat-damaged', FACT));
    chats.save(record('chat-free', FACT));
    const damaged = filesUnder(join(dir, 'sessions')).find((file) =>
      file.includes('chat-damaged'),
    )!;
    writeFileSync(damaged, `{ not json ${FACT}`);
    const parked = filesUnder(join(dir, 'sessions')).find((file) => file.includes('chat-parked'))!;
    const heldPath = filesUnder(join(dir, 'sessions')).find((file) => file.includes('chat-held'))!;
    const bytes = new Map([damaged, parked, heldPath].map((file) => [file, readFileSync(file)]));
    // Another agent runs this conversation: it holds the id's writer marker.
    const otherAgent = createPersonalSessionStore(dir);
    const claim = otherAgent.claim('chat-held');
    try {
      const result = await wiki.forgetWithReport({ claimId: filed.claimId });
      expect(result.conversations).toMatchObject({ cleaned: 1, pending: 0, notReached: 3 });
      for (const [file, before] of bytes) expect(readFileSync(file).equals(before)).toBe(true);
      expect(
        readFileSync(
          filesUnder(join(dir, 'sessions')).find((f) => f.includes('chat-free'))!,
          'utf8',
        ),
      ).not.toContain('4471');
    } finally {
      claim.release();
    }
  });

  it('looks for a short statement only in the conversation it was learned in', async () => {
    const dir = stateDir();
    const { wiki, chats } = await world(dir);
    const filed = await wiki.remember({
      pageTitle: 'Drinks',
      kind: 'preference',
      claim: 'likes tea',
      source: { origin: 'owner', sessionId: 'chat-source' },
    });
    chats.save(record('chat-source', 'likes tea'));
    chats.save(record('chat-other', 'likes tea'));
    const result = await wiki.forgetWithReport({ claimId: filed.claimId });
    expect(result.conversations).toMatchObject({ cleaned: 1, notReached: 0 });
    const source = chats.load('chat-source');
    const other = chats.load('chat-other');
    expect(source.status === 'valid' && source.record.messages[0]!.content).toBe(
      `Remember: ${GONE}.`,
    );
    expect(other.status === 'valid' && other.record.messages[0]!.content).toBe(
      'Remember: likes tea.',
    );
  });

  it('cleans a session it runs when idle, and owes the cleaning to a busy one until its turn ends', async () => {
    const dir = stateDir();
    const { wiki, forgetting, chats } = await world(dir);
    const owed = createOwedRedactions();
    const handlers = new Set<() => void>();
    let busy = true;
    let redactions = 0;
    const session: ILiveConversation = {
      sessionId: 'chat-live',
      getName: () => 'Live chat',
      redactConversation: (redact) => {
        if (busy) return 'busy';
        redactions += redact(FACT) === GONE ? 1 : 0;
        return 'redacted';
      },
      on: (_event, handler) => void handlers.add(handler),
      off: (_event, handler) => void handlers.delete(handler),
    };
    forgetting.bind({ live: () => [session], owed });
    const filed = await wiki.remember({
      pageTitle: 'Home',
      kind: 'matter',
      claim: FACT,
      source: { origin: 'owner', sessionId: 'chat-live' },
    });
    chats.save(record('chat-stored', FACT));
    const result = await wiki.forgetWithReport({ claimId: filed.claimId });
    expect(result.conversations).toMatchObject({ cleaned: 1, pending: 1, notReached: 0 });
    expect(result.conversations?.sources).toEqual(['Live chat']);
    // A save made meanwhile is cleaned on the way to disk.
    expect(owed.redactorFor('chat-live')?.(FACT)).toBe(GONE);
    expect(handlers.size).toBeGreaterThan(0);

    busy = false;
    for (const handler of handlers) handler();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(redactions).toBe(1);
    expect(owed.redactorFor('chat-live')).toBeUndefined();
    expect(handlers.size).toBe(0);
    forgetting.dispose();
  });

  it('cleans what a session saves while its forget is owed, and stops once it is paid', () => {
    const dir = stateDir();
    const owed = createOwedRedactions();
    const store = createPersonalSessionStore(dir, owed);
    store.save(record('chat-busy', FACT));
    expect(holders(dir, FACT)).toHaveLength(1);
    owed.owe('chat-busy', [FACT]);
    store.save(record('chat-busy', `${FACT} again`));
    store.save(record('chat-other', FACT));
    // Only the session that owes is cleaned; the other keeps what a forget did not name for it.
    expect(holders(dir, FACT).map((file) => file.includes('chat-other'))).toEqual([true]);
    owed.settle('chat-busy');
    store.save(record('chat-busy', FACT));
    expect(holders(dir, FACT)).toHaveLength(2);
  });

  it('runs two forgets at once one after the other', async () => {
    const dir = stateDir();
    mkdirSync(join(dir, 'wiki'), { recursive: true });
    const { wiki } = await world(dir);
    const a = await wiki.remember({
      pageTitle: 'A',
      kind: 'matter',
      claim: FACT,
      source: { origin: 'owner' },
    });
    const b = await wiki.remember({
      pageTitle: 'B',
      kind: 'matter',
      claim: 'The alarm code is 9981-OMEGA',
      source: { origin: 'owner' },
    });
    const [first, second] = await Promise.all([
      wiki.forgetWithReport({ claimId: a.claimId }),
      wiki.forgetWithReport({ claimId: b.claimId }),
    ]);
    expect(first.forgotten).toBe(1);
    expect(second.forgotten).toBe(1);
    expect(first.reachFailed).toBeUndefined();
    expect(second.reachFailed).toBeUndefined();
  });
});
