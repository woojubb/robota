import { describe, expect, it } from 'vitest';

import {
  buildHandoffManifest,
  sealHandoffRecord,
  verifyHandoffPayload,
  type IBuildManifestInput,
  type ISourceRuntimeState,
} from '../handoff-manifest.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';

const NOW = 1_700_000_000_000;

function aRecord(over: Partial<IInteractiveSessionRecord> = {}): IInteractiveSessionRecord {
  return {
    id: 'session_1',
    cwd: '/home/alice/project',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T01:00:00.000Z',
    messages: [],
    ...over,
  };
}

function input(runtime: ISourceRuntimeState = {}, record = aRecord()): IBuildManifestInput {
  return {
    handoffId: 'handoff_1',
    sessionId: 'session_1',
    sourceDeviceId: 'device_a',
    destinationDeviceId: 'device_b',
    record,
    runtime,
    offeredAt: NOW,
  };
}

/** Narrow a result to the built case so a failure reads as an assertion rather than a type error. */
function built(result: ReturnType<typeof buildHandoffManifest>) {
  if (!result.built) throw new Error(`expected a manifest, got refusal: ${result.refusal}`);
  return result;
}

function itemFor(result: ReturnType<typeof built>, kind: string) {
  return result.manifest.inventory.find((i) => i.kind === kind);
}

describe('HANDOFF-001 TC-01 — the inventory classifies every category, including what stays', () => {
  it('carries the conversation and the session metadata', () => {
    const result = built(buildHandoffManifest(input()));

    expect(itemFor(result, 'conversation')?.disposition).toBe('transferred');
    expect(itemFor(result, 'session-metadata')?.disposition).toBe('transferred');
  });

  it('marks provider credentials never-transferred, distinctly from what merely stays behind', () => {
    // The distinction is the point. `source-local` is a product decision that could be revisited;
    // this is a rule — SEC-009 established a resolved credential must not cross a process boundary,
    // and a machine boundary is strictly worse.
    const result = built(buildHandoffManifest(input({ uncommittedChanges: true })));

    expect(itemFor(result, 'provider-credentials')?.disposition).toBe('never-transferred');
    expect(itemFor(result, 'uncommitted-changes')?.disposition).toBe('source-local');
  });

  it('carries the working directory as a reference the destination must resolve', () => {
    const result = built(buildHandoffManifest(input()));
    const item = itemFor(result, 'working-directory');

    expect(item?.disposition).toBe('rehydrated');
    expect(item?.note).toContain('/home/alice/project');
  });

  it('reports subprocesses as staying, with how many', () => {
    const result = built(buildHandoffManifest(input({ subprocesses: 2 })));
    const item = itemFor(result, 'subprocesses');

    expect(item?.disposition).toBe('source-local');
    expect(item?.note).toContain('2 running process');
  });

  it('does not claim state stayed behind when there was none of it', () => {
    // An inventory that listed every optional field regardless would tell a user their goal state
    // stayed behind when they never had any — a report that is false in the direction of alarming.
    const result = built(buildHandoffManifest(input()));

    expect(itemFor(result, 'uncommitted-changes')).toBeUndefined();
    expect(itemFor(result, 'subprocesses')).toBeUndefined();
    expect(itemFor(result, 'goal-and-plan')).toBeUndefined();
    expect(itemFor(result, 'sandbox-snapshot')).toBeUndefined();
  });

  it('includes goal, background work and the sandbox reference when present', () => {
    const record = aRecord({
      goal: { id: 'g' } as IInteractiveSessionRecord['goal'],
      backgroundTasks: [{ id: 't' } as never],
      sandboxSnapshotId: 'snap_1',
    });

    const result = built(buildHandoffManifest(input({}, record)));

    expect(itemFor(result, 'goal-and-plan')?.disposition).toBe('transferred');
    expect(itemFor(result, 'background-work')?.disposition).toBe('transferred');
    expect(itemFor(result, 'sandbox-snapshot')?.disposition).toBe('rehydrated');
  });
});

describe('HANDOFF-001 TC-08 — in-flight work is refused, not snapshotted', () => {
  it.each([
    ['a model call', { modelCallInFlight: true }],
    ['a tool call', { toolCallsInFlight: 1 }],
  ])('refuses while %s is in flight', (_label, runtime) => {
    // A turn in flight has an outcome that belongs in the history being transferred. Snapshotting
    // produces a digest that is correct for a session state that never settled.
    const result = buildHandoffManifest(input(runtime));

    expect(result.built).toBe(false);
    if (!result.built) expect(result.refusal).toBe('in-flight-work');
  });

  it('says what the caller can do about it, since the choice is theirs', () => {
    const result = buildHandoffManifest(input({ modelCallInFlight: true }));

    if (!result.built) expect(result.detail).toMatch(/Wait for it, or cancel it/);
  });

  it('builds once nothing is in flight', () => {
    expect(buildHandoffManifest(input({ toolCallsInFlight: 0 })).built).toBe(true);
  });
});

describe('HANDOFF-001 TC-06 — a payload that did not arrive whole is refused', () => {
  it('accepts the exact bytes that were sealed', () => {
    const { serialized, integrity } = sealHandoffRecord(aRecord());

    expect(verifyHandoffPayload(serialized, integrity).intact).toBe(true);
  });

  it('reports a truncated payload as truncated, not as corruption', () => {
    // Checked BEFORE the digest. Hashing a short buffer to discover it was short wastes the work
    // and reports a dropped connection as tampering.
    const { serialized, integrity } = sealHandoffRecord(aRecord());

    const verdict = verifyHandoffPayload(serialized.slice(0, -20), integrity);

    expect(verdict.failure).toBe('truncated');
    expect(verdict.expectedBytes).toBe(integrity.byteLength);
    expect(verdict.actualBytes).toBeLessThan(integrity.byteLength);
  });

  it('reports a same-length substitution as a digest mismatch', () => {
    // The case length alone cannot catch, which is why the digest is there at all.
    const { serialized, integrity } = sealHandoffRecord(aRecord());
    const tampered = serialized.replace('/home/alice/project', '/home/mallor/projec');

    expect(tampered).toHaveLength(serialized.length);
    expect(verifyHandoffPayload(tampered, integrity).failure).toBe('digest-mismatch');
  });

  it('the manifest digest covers the bytes the builder hands back', () => {
    // The seal and the send must agree. A caller that re-serialized the record could produce a
    // different key order and a digest mismatch on a payload that is perfectly correct.
    const result = built(buildHandoffManifest(input()));

    expect(verifyHandoffPayload(result.serialized, result.manifest.integrity).intact).toBe(true);
  });

  it('two different records do not seal to the same digest', () => {
    const a = sealHandoffRecord(aRecord());
    const b = sealHandoffRecord(aRecord({ cwd: '/elsewhere' }));

    expect(a.integrity.digest).not.toBe(b.integrity.digest);
  });
});
