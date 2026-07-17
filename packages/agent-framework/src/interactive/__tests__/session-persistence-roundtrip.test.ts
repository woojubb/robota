import { mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';
import { describe, expect, it } from 'vitest';

import { createProjectSessionStore } from '../session-persistence.js';

/**
 * DATA-006 (ARL-08): the SessionStore JSON record round-trip must preserve EVERY
 * `IInteractiveSessionRecord` field. The `Required<IInteractiveSessionRecord>` typing forces the fixture
 * to enumerate every field (a new field breaks this fixture's compile until it is populated), so the
 * deep-equal exercises the whole surface — most importantly `goal`, which the old hand-enumerated
 * `fromSessionRecord` silently dropped on load. The structural mirror (`{ ...session }`), not this test,
 * is what makes drift impossible; this test is JSON round-trip integrity + regression coverage.
 */
describe('session persistence round-trip (DATA-006 / ARL-08)', () => {
  async function makeStore(): Promise<{
    store: ReturnType<typeof createProjectSessionStore>;
    cwd: string;
  }> {
    const cwd = await mkdtemp(join(tmpdir(), 'robota-sdk-session-roundtrip-'));
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    return { store: createProjectSessionStore(cwd), cwd };
  }

  function fullRecord(cwd: string): Required<IInteractiveSessionRecord> {
    return {
      id: 'session_full',
      name: 'full-fixture',
      cwd,
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:01:00.000Z',
      // Values must be JSON-stable for a deep-equal round-trip. Message factories inject a `Date`
      // `timestamp` that JSON serializes to a string (a message-payload serialization detail, out of
      // scope for DATA-006 which is about field completeness); keep messages empty here so the test
      // asserts field-completeness + JSON integrity without that red herring.
      messages: [],
      history: [],
      systemPrompt: 'you are a helpful assistant',
      toolSchemas: [],
      backgroundTasks: [],
      backgroundTaskEvents: [],
      backgroundJobGroups: [],
      backgroundJobGroupEvents: [],
      skillActivationEvents: [],
      memoryEvents: [],
      usedMemoryReferences: [],
      contextReferences: [],
      sandboxSnapshotId: 'sandbox-snapshot-full',
      goal: {
        id: 'goal_1',
        objective: 'finish the audit',
        status: 'active',
        iterations: 2,
        maxIterations: 10,
        startedAt: '2026-05-05T00:00:30.000Z',
        progress: [{ iteration: 1, signal: 'continue', reason: 'made progress' }],
      },
      plan: {
        id: 'plan_1',
        objective: 'ship the feature',
        steps: [{ id: 'plan_1_0', description: 'draft the change', status: 'pending' }],
        phase: 'awaiting-approval',
        createdAt: '2026-05-05T00:00:45.000Z',
        approvedAt: '2026-05-05T00:00:50.000Z',
      },
    };
  }

  it('TC-01: preserves an in-flight `goal` across save → load (regression for ARL-08)', async () => {
    const { store, cwd } = await makeStore();
    const record = fullRecord(cwd);

    store.save(record);
    const loaded = store.load(record.id);

    expect(loaded?.goal).toEqual(record.goal);
  });

  it('TC-02: every IInteractiveSessionRecord field survives the JSON round-trip', async () => {
    const { store, cwd } = await makeStore();
    const record = fullRecord(cwd);

    store.save(record);
    const loaded = store.load(record.id);

    expect(loaded).toEqual(record);
  });
});
