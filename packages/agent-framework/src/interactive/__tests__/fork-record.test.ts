/**
 * CLI-1994 TC-01 / TC-02 — a fork is a COPY of the live conversation under a fresh id.
 *
 * `buildForkedSessionRecord` is the whole mechanism `/fork` has for reading the parent: it copies
 * exactly the members a fork inherits (messages, the assembled system message, tool schemas, the
 * full history) and drops the members the startup `--fork-session` already drops (sandbox snapshot,
 * goal, plan, active branch). TC-02 is the append-only invariant `fork-restores-context.test.ts`
 * pins for the startup fork, restated for the in-session one: writing the copy never touches the
 * source file.
 */

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildForkedSessionRecord,
  type TForkSourceSession,
} from '../interactive-session-fork-record.js';
import { listedRecords, loadedRecord } from './session-load-helpers.js';

import type { IHistoryEntry, TUniversalMessage } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const SOURCE_ID = 'session_cli-1994-source';
const SOURCE_NAME = 'parent-work';
const SYSTEM_PROMPT = 'You are the parent session. Remember everything.';

const MESSAGES: TUniversalMessage[] = [
  {
    id: 'm-1',
    role: 'user',
    content: 'Remember the number 42.',
    timestamp: new Date('2026-08-01T00:00:00.000Z'),
    state: 'complete',
  },
  {
    id: 'm-2',
    role: 'assistant',
    content: 'Noted: 42.',
    timestamp: new Date('2026-08-01T00:00:01.000Z'),
    state: 'complete',
  },
];

const HISTORY: IHistoryEntry[] = MESSAGES.map((message) => ({
  id: `h-${message.id}`,
  timestamp: message.timestamp,
  category: 'chat',
  type: message.role,
  data: message,
}));

/** The four members a fork reads, answered from the fixture above. */
function sourceSession(): TForkSourceSession {
  return {
    getHistory: () => MESSAGES,
    getSystemMessage: () => SYSTEM_PROMPT,
    getToolSchemas: () => [
      { name: 'Read', description: 'read', parameters: { type: 'object', properties: {} } },
    ],
    getFullHistory: () => HISTORY,
  };
}

/** A source record that carries every member a fork must NOT inherit. */
function sourceRecord(cwd: string): IInteractiveSessionRecord {
  return {
    id: SOURCE_ID,
    name: SOURCE_NAME,
    cwd,
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    messages: MESSAGES,
    history: HISTORY,
    systemPrompt: SYSTEM_PROMPT,
    sandboxSnapshotId: 'snap-1',
    goal: {
      id: 'g-1',
      objective: 'finish',
      status: 'active',
      iterations: 0,
      maxIterations: 3,
      startedAt: '2026-06-13T00:00:00.000Z',
      progress: [],
    },
    plan: {
      id: 'p-1',
      objective: 'plan it',
      steps: [],
      phase: 'planning',
      createdAt: '2026-06-13T00:00:00.000Z',
    },
    activeBranch: { branchId: 'b-1', checkpointId: 'cp-1' },
  };
}

describe('buildForkedSessionRecord (CLI-1994)', () => {
  let cwd: string;
  let store: NodeSessionStore;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-1994-fork-')));
    store = new NodeSessionStore(join(cwd, 'sessions'));
    store.save(sourceRecord(cwd));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('TC-01: the copy has a fresh id, the source conversation and prompt, a distinct name, and none of the dropped fields', () => {
    const fork = buildForkedSessionRecord({
      source: sourceSession(),
      name: `${SOURCE_NAME} (fork)`,
      cwd,
    });

    expect(fork.id).not.toBe(SOURCE_ID);
    expect(fork.id).toMatch(/^session_[0-9a-f-]{36}$/);
    expect(fork.messages).toEqual(MESSAGES);
    expect(fork.history).toEqual(HISTORY);
    expect(fork.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(fork.toolSchemas).toEqual(sourceSession().getToolSchemas());
    expect(fork.name).toBe(`${SOURCE_NAME} (fork)`);
    expect(fork.name).not.toBe(SOURCE_NAME);
    expect(fork.cwd).toBe(cwd);
    // Dropped exactly as the startup fork drops them (interactive-session.ts restore path).
    expect(fork).not.toHaveProperty('goal');
    expect(fork).not.toHaveProperty('plan');
    expect(fork).not.toHaveProperty('activeBranch');
    expect(fork).not.toHaveProperty('sandboxSnapshotId');
    // Fresh timestamps: the copy's life starts now, not when the parent started.
    expect(fork.createdAt).toBe(fork.updatedAt);
    expect(Date.parse(fork.createdAt)).toBeGreaterThan(Date.parse('2026-06-13T00:00:00.000Z'));
  });

  it("TC-01: the copied arrays are the fork's own — mutating them never reaches the source", () => {
    const source = sourceSession();
    const fork = buildForkedSessionRecord({ source, name: 'copy', cwd });

    fork.messages.push({
      id: 'm-3',
      role: 'user',
      content: 'only in the fork',
      timestamp: new Date(),
      state: 'complete',
    });
    fork.history?.push(HISTORY[0]!);

    expect(source.getHistory()).toHaveLength(2);
    expect(source.getFullHistory()).toHaveLength(2);
  });

  it('TC-02: writing the forked record leaves the source file byte-identical and the store lists exactly two records', () => {
    const sourcePath = join(cwd, 'sessions', `${SOURCE_ID}.json`);
    const before = readFileSync(sourcePath, 'utf8');

    const fork = buildForkedSessionRecord({ source: sourceSession(), name: 'experiment', cwd });
    store.save(fork);

    const after = readFileSync(sourcePath, 'utf8');
    expect(after).toBe(before);

    const records = listedRecords(store);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.id).sort()).toEqual([SOURCE_ID, fork.id].sort());
    // The persisted copy reads back as the copy — the same conversation under the new id.
    expect(loadedRecord(store, fork.id).messages).toEqual(MESSAGES);
    expect(loadedRecord(store, SOURCE_ID).name).toBe(SOURCE_NAME);
  });
});
