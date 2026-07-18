import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { createFileSystemMemoryStore } from '../../memory/file-system-memory-store.js';
import { InteractiveSession } from '../interactive-session.js';
import { createProjectSessionStore } from '../session-persistence.js';

import type { IAutomaticMemoryConfig } from '../../memory/automatic-memory-types.js';
import type { IMemoryStore } from '../../memory/types.js';
import type { IAIProvider } from '@robota-sdk/agent-core';

/**
 * SELFHOST-008 P2 — post-turn auto-capture wired into the live turn (option B: awaited in the execution
 * controller's `finally`, before `persistSession()`, on the completed-turn path, guarded).
 */

const TMP_BASE = join(tmpdir(), `robota-auto-capture-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createProvider(response = 'ok'): IAIProvider {
  return {
    name: 'mock',
    version: 'test',
    chat: vi.fn().mockResolvedValue({
      role: 'assistant',
      content: response,
      timestamp: new Date('2026-05-02T00:00:00.000Z'),
    }),
    generateResponse: vi.fn(),
  } as unknown as IAIProvider;
}

const APPROVAL: IAutomaticMemoryConfig = {
  policy: 'approval_required',
  retrieval: { maxTopics: 3, maxTopicChars: 3000 },
};
const AUTO_SAVE: IAutomaticMemoryConfig = {
  policy: 'auto_save',
  retrieval: { maxTopics: 3, maxTopicChars: 3000 },
};

const CUE = 'remember that this project uses pnpm for package scripts';

beforeEach(() => {
  const home = join(TMP_BASE, 'home');
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('SELFHOST-008 P2 TC-01/TC-05 — capture fires on a completed turn (queue-by-default)', () => {
  it('approval_required: a memory cue turn QUEUES a candidate + records a memory event (not auto-saved)', async () => {
    const cwd = makeProject();
    const sessionStore = createProjectSessionStore(cwd);
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('noted'),
      bare: true,
      sessionStore,
      automaticMemory: APPROVAL,
    });

    await session.submit(CUE);

    // queued, not durably saved
    expect(existsSync(join(cwd, '.robota', 'memory', 'pending.json'))).toBe(true);
    expect(existsSync(join(cwd, '.robota', 'memory', 'MEMORY.md'))).toBe(false);
    // memory event recorded IN this turn's persisted record (proves await-before-persist)
    const saved = sessionStore.load(session.getSession().getSessionId());
    const types = (saved?.memoryEvents ?? []).map((e) => e.type);
    expect(types).toContain('memory_candidate_extracted');
    expect(types).toContain('memory_candidate_queued');
  });

  it('auto_save: a high-confidence cue turn SAVES durably + records a saved event', async () => {
    const cwd = makeProject();
    const sessionStore = createProjectSessionStore(cwd);
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('noted'),
      bare: true,
      sessionStore,
      automaticMemory: AUTO_SAVE,
    });

    await session.submit(CUE);

    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      'this project uses pnpm for package scripts',
    );
    const saved = sessionStore.load(session.getSession().getSessionId());
    expect((saved?.memoryEvents ?? []).map((e) => e.type)).toContain('memory_candidate_saved');
  });
});

describe('SELFHOST-008 P2 TC-03 — adapter-gating: no automaticMemory ⇒ capture OFF', () => {
  it('a memory-cue turn writes NO pending and records NO memory events', async () => {
    const cwd = makeProject();
    const sessionStore = createProjectSessionStore(cwd);
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('ok'),
      bare: true,
      sessionStore,
    });

    await session.submit(CUE);

    expect(existsSync(join(cwd, '.robota', 'memory', 'pending.json'))).toBe(false);
    expect(sessionStore.load(session.getSession().getSessionId())?.memoryEvents).toEqual([]);
  });
});

describe('SELFHOST-008 P2 TC-04 — sensitive content is refused on the capture path', () => {
  it('auto_save: a cue containing a secret yields NO durable save and NO queued candidate', async () => {
    const cwd = makeProject();
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('ok'),
      bare: true,
      automaticMemory: AUTO_SAVE,
    });

    await session.submit('remember that my api_key is sk-live-super-secret-value');

    expect(existsSync(join(cwd, '.robota', 'memory', 'MEMORY.md'))).toBe(false);
    // the pending queue, if created, holds a 'skipped' record — never 'pending'/'saved' for this content
    const pendingPath = join(cwd, '.robota', 'memory', 'pending.json');
    if (existsSync(pendingPath)) {
      const doc = JSON.parse(readFileSync(pendingPath, 'utf8')) as {
        records: { status: string }[];
      };
      expect(doc.records.every((r) => r.status === 'skipped')).toBe(true);
    }
  });
});

describe('SELFHOST-008 P2 TC-02a — guarded: a capture failure never breaks the turn', () => {
  it('an injected store whose writes REJECT does not fail the turn (submit resolves)', async () => {
    const cwd = makeProject();
    const base = createFileSystemMemoryStore(cwd);
    const rejectingStore: IMemoryStore = {
      loadStartupMemory: () => base.loadStartupMemory(),
      list: () => base.list(),
      readTopic: (t) => base.readTopic(t),
      recall: (q, b) => base.recall(q, b),
      getPending: (id) => base.getPending(id),
      listPending: (s) => base.listPending(s),
      markPending: (id, s, r) => base.markPending(id, s, r),
      append: async () => {
        throw new Error('boom-append');
      },
      upsertPending: async () => {
        throw new Error('boom-upsert');
      },
    };
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('ok'),
      bare: true,
      memoryStore: rejectingStore,
      automaticMemory: AUTO_SAVE,
    });

    // must resolve (not reject) despite the capture store throwing
    await expect(session.submit(CUE)).resolves.toBeUndefined();
  });
});

describe('SELFHOST-008 P2 TC-02b — event lands in the SAME turn record even when capture resolves on a deferred tick', () => {
  it('a deferred-resolving injected store still has its event in the persisted record (await-before-persist)', async () => {
    const cwd = makeProject();
    const sessionStore = createProjectSessionStore(cwd);
    const base = createFileSystemMemoryStore(cwd);
    const defer = <T>(v: () => Promise<T> | T): Promise<T> =>
      new Promise((resolve) => setTimeout(() => resolve(Promise.resolve(v())), 5));
    // every write resolves on a macrotask — if the controller did NOT await capture before persist,
    // the recorded events would miss this turn's persisted record.
    const deferredStore: IMemoryStore = {
      loadStartupMemory: () => base.loadStartupMemory(),
      list: () => base.list(),
      readTopic: (t) => base.readTopic(t),
      recall: (q, b) => base.recall(q, b),
      getPending: (id) => defer(() => base.getPending(id)),
      listPending: (s) => defer(() => base.listPending(s)),
      markPending: (id, s, r) => defer(() => base.markPending(id, s, r)),
      append: (input) => defer(() => base.append(input)),
      upsertPending: (c, s, r) => defer(() => base.upsertPending(c, s, r)),
    };
    const session = new InteractiveSession({
      cwd,
      provider: createProvider('noted'),
      bare: true,
      sessionStore,
      memoryStore: deferredStore,
      automaticMemory: APPROVAL,
    });

    await session.submit(CUE);

    const saved = sessionStore.load(session.getSession().getSessionId());
    expect((saved?.memoryEvents ?? []).map((e) => e.type)).toContain('memory_candidate_queued');
  });
});
