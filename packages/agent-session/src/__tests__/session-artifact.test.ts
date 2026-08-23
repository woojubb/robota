import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scrubSensitiveKeys } from '../scrub-sensitive.js';
import { deserializeSessionArtifact, serializeSessionArtifact } from '../session-artifact.js';
import { SESSION_ARTIFACT_SCHEMA_VERSION } from '../session-record-codec/index.js';
import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';

/**
 * SELFHOST-014 — the export/import artifact envelope over the canonical interactive session record.
 */

/**
 * A record that actually satisfies `IInteractiveSessionRecord`.
 *
 * TRANS-006: this fixture used to be a stub cast through `as unknown as IInteractiveSessionRecord` —
 * messages with no `id`, `timestamp` or `state`, history entries with a `text` member the contract
 * does not declare, background tasks carrying two of ten required members, a goal missing five. It
 * passed because nothing on this path validated anything, so the suite asserted round-trip fidelity
 * for a value that was never a session record. The cast is gone deliberately: it is what let the
 * fixture drift from the contract it claims to be.
 *
 * The secret used by the redact test now lives in `messages[0].metadata`, which the contract leaves
 * open, rather than on the message itself where no such member exists.
 */
function fullRecord(): IInteractiveSessionRecord {
  return {
    id: 'sess_1',
    name: 'demo',
    cwd: '/work/project',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T01:00:00.000Z',
    messages: [
      {
        id: 'msg_1',
        role: 'user',
        content: 'hi',
        timestamp: new Date('2026-07-19T00:30:00.000Z'),
        state: 'complete',
        metadata: { apiKey: 'sk-leak' },
      },
    ],
    history: [
      {
        id: 'hist_1',
        timestamp: new Date('2026-07-19T00:30:00.000Z'),
        category: 'chat',
        type: 'user',
        data: { text: 'hi' },
      },
    ],
    systemPrompt: 'you are helpful',
    backgroundTasks: [
      {
        id: 'bg_1',
        kind: 'agent',
        label: 'a background task',
        status: 'sleeping',
        mode: 'background',
        parentSessionId: 'sess_1',
        depth: 0,
        cwd: '/work/project',
        updatedAt: '2026-07-19T00:45:00.000Z',
        unread: true,
      },
    ],
    backgroundTaskEvents: [
      {
        type: 'background_task_created',
        task: {
          id: 'bg_1',
          kind: 'agent',
          label: 'a background task',
          status: 'sleeping',
          mode: 'background',
          parentSessionId: 'sess_1',
          depth: 0,
          cwd: '/work/project',
          updatedAt: '2026-07-19T00:45:00.000Z',
          unread: true,
        },
      },
    ],
    goal: {
      id: 'goal_1',
      objective: 'ship',
      status: 'active',
      iterations: 1,
      maxIterations: 10,
      startedAt: '2026-07-19T00:10:00.000Z',
      progress: [{ iteration: 1, signal: 'continue', reason: 'still working' }],
    },
    contextReferences: [
      {
        id: 'ref_1',
        sourcePath: '/work/project/AGENTS.md',
        relativePath: 'AGENTS.md',
        originalReference: '@AGENTS.md',
        loadType: 'manual',
        status: 'active',
        byteLength: 120,
        loadedAt: '2026-07-19T00:05:00.000Z',
      },
    ],
    sandboxSnapshotId: 'snap_1',
  };
}

/**
 * What a record looks like after a STORE round-trip, which is not what it looks like after an
 * ARTIFACT round-trip.
 *
 * TRANS-006 routes the artifact importer through the decoder, so `deserializeSessionArtifact`
 * returns real `Date`s. `NodeSessionStore.load` still does a bare `JSON.parse` cast — that is
 * issue #2096's scope, not this leaf's — so a record written to the store and read back has ISO
 * STRINGS where the contract declares `Date`.
 *
 * The asymmetry is asserted rather than papered over: these helpers make it visible, and when
 * issue #2096 lands and the store decodes too, these expectations go red and are deleted. A test
 * that quietly compared only the fields JSON preserves would let that day pass unnoticed.
 */
function asStoreRoundTripped(
  messages: IInteractiveSessionRecord['messages'],
): IInteractiveSessionRecord['messages'] {
  return JSON.parse(JSON.stringify(messages)) as IInteractiveSessionRecord['messages'];
}

function asStoreRoundTrippedHistory(
  history: NonNullable<IInteractiveSessionRecord['history']>,
): NonNullable<IInteractiveSessionRecord['history']> {
  return JSON.parse(JSON.stringify(history)) as NonNullable<IInteractiveSessionRecord['history']>;
}

function newStore(): NodeSessionStore {
  return new NodeSessionStore(mkdtempSync(path.join(tmpdir(), 'artifact-store-')));
}

describe('session artifact — round-trip fidelity (TC-01)', () => {
  it('deserialize(serialize(record)) deep-equals the record with no redaction', () => {
    const record = fullRecord();
    const restored = deserializeSessionArtifact(serializeSessionArtifact(record));
    expect(restored).toEqual(record);
  });
});

describe('session artifact — schema-version guard (TC-02)', () => {
  it('carries a schema-version header and imports a same-version artifact cleanly', () => {
    const bytes = serializeSessionArtifact(fullRecord());
    expect(JSON.parse(bytes).schemaVersion).toBe(SESSION_ARTIFACT_SCHEMA_VERSION);
    expect(deserializeSessionArtifact(bytes).id).toBe('sess_1');
  });

  it('rejects an unknown/incompatible schema version rather than mis-importing', () => {
    const future = JSON.stringify({ schemaVersion: 999, record: fullRecord() });
    expect(() => deserializeSessionArtifact(future)).toThrow(/schema version/i);
    expect(() => deserializeSessionArtifact(JSON.stringify({ record: fullRecord() }))).toThrow(
      /schema version/i,
    );
  });

  // TRANS-006: the rejection is now LOCATED. The assertion moved from "the message says malformed"
  // to "the message names where", because a decoder that refuses without saying where leaves the
  // holder of an unimportable artifact with a boolean and no next step.
  it('rejects a degenerate/crafted record (array, {}, or missing id) and names the field', () => {
    for (const record of [[], {}, { name: 'no-id' }]) {
      expect(() =>
        deserializeSessionArtifact(JSON.stringify({ schemaVersion: 1, record })),
      ).toThrow(/Invalid session artifact: record/);
    }
  });
});

describe('session artifact — export-for-share redact seam (TC-07)', () => {
  it('applies an app-supplied redact (strip cwd/sandboxSnapshotId + scrub secrets); no-redact keeps them', () => {
    const record = fullRecord();
    // App-owned FIELD policy lives here (in the test = the app), never in the library.
    const redact = (r: IInteractiveSessionRecord): IInteractiveSessionRecord => {
      // TRANS-006: `cwd` is REQUIRED, so the host path is BLANKED rather than deleted — a redact
      // returns a record, and deleting a required member returns something that is not one.
      // `sandboxSnapshotId` is optional, so removing it entirely is still a record.
      const { sandboxSnapshotId: _snap, ...rest } = r as IInteractiveSessionRecord & {
        sandboxSnapshotId?: string;
      };
      return scrubSensitiveKeys({ ...rest, cwd: '' }) as IInteractiveSessionRecord;
    };

    const shared = deserializeSessionArtifact(serializeSessionArtifact(record, { redact }));
    expect(shared.cwd).toBe(''); // blanked, not absent — still a record

    expect((shared as { sandboxSnapshotId?: string }).sandboxSnapshotId).toBeUndefined();
    expect(shared.messages[0]?.metadata?.['apiKey']).toBe('[REDACTED]');

    // Without redact, the full-fidelity form retains everything (op 1 ≠ op 2).
    const full = deserializeSessionArtifact(serializeSessionArtifact(record));
    expect(full.cwd).toBe('/work/project');
    expect(full.messages[0]?.metadata?.['apiKey']).toBe('sk-leak');
  });
});

describe('session artifact — async share → resume across two independent surfaces (TC-04)', () => {
  it('exports from store A and re-imports into a DISTINCT store B; the record resumes identically', () => {
    const storeA = newStore();
    const record = fullRecord();
    storeA.save(record);

    // Export from A → hand off → import into an INDEPENDENT store B (different baseDir; A may be offline).
    const artifact = serializeSessionArtifact(storeA.load(record.id)!);
    const storeB = newStore();
    storeB.save(deserializeSessionArtifact(artifact));

    const onB = storeB.load(record.id);
    expect(onB?.messages).toEqual(asStoreRoundTripped(record.messages));
    expect(onB?.history).toEqual(asStoreRoundTrippedHistory(record.history!));
    expect(onB?.goal).toEqual(record.goal);

    // The import DID decode — the asymmetry is the store's, not the artifact's.
    expect(deserializeSessionArtifact(artifact).messages[0]?.timestamp).toBeInstanceOf(Date);
    expect(typeof (onB?.messages[0]?.timestamp as unknown)).toBe('string');
    // Stores are independent — deleting B's imported record does not affect A.
    storeB.delete(record.id);
    expect(storeA.load(record.id)?.id).toBe(record.id);
    expect(storeB.load(record.id)).toBeUndefined();
  });
});

describe('session artifact — a REDACTED artifact still resumes on B with import-side rebind (TC-08)', () => {
  it('redact BLANKS required cwd → import on B → app rebinds B cwd → resumes with content intact', () => {
    const record = fullRecord();
    const redactBlankCwd = (r: IInteractiveSessionRecord): IInteractiveSessionRecord => ({
      ...r,
      cwd: '',
    });
    const artifact = serializeSessionArtifact(record, { redact: redactBlankCwd });

    const imported = deserializeSessionArtifact(artifact);
    expect(imported.cwd).toBe(''); // host path gone, and the value is still a record

    // The IMPORT/APP layer on surface B rebinds the stripped required field with B's own cwd.
    const storeB = newStore();
    storeB.save({ ...imported, cwd: '/surface-b/checkout' });

    const onB = storeB.load(record.id);
    expect(onB?.cwd).toBe('/surface-b/checkout'); // rebound
    expect(onB?.messages).toEqual(asStoreRoundTripped(record.messages)); // content intact
    expect(onB?.history).toEqual(asStoreRoundTrippedHistory(record.history!));
    expect(onB?.goal).toEqual(record.goal);
  });
});

/**
 * TRANS-006 (issue #2097) — the importer decodes the whole record, not the envelope and one field.
 *
 * Before this leaf `deserializeSessionArtifact` checked `schemaVersion`, then that `record` was a
 * non-array object whose `id` was a string, and returned everything else unchecked. Every case below
 * imported successfully then.
 */
describe('session artifact — the record is decoded, not cast (TRANS-006)', () => {
  function artifactOf(record: unknown): string {
    return JSON.stringify({ schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION, record });
  }

  it.each([
    ['messages is not an array', { ...fullRecord(), messages: 'not-an-array' }, 'messages'],
    [
      'a message has no timestamp',
      { ...fullRecord(), messages: [{ id: 'm', role: 'user', content: 'x', state: 'complete' }] },
      'messages[0].timestamp',
    ],
    [
      'a message state is not in the union',
      { ...fullRecord(), messages: [{ ...fullRecord().messages[0], state: 'halfway' }] },
      'messages[0].state',
    ],
    [
      'updatedAt is not a parseable instant',
      { ...fullRecord(), updatedAt: 'last thursday' },
      'updatedAt',
    ],
    [
      'the goal is missing a required member',
      { ...fullRecord(), goal: { id: 'g', objective: 'x' } },
      'goal',
    ],
    ['a member the contract does not declare', { ...fullRecord(), surprise: true }, 'surprise'],
    [
      'a required member was DELETED by a redact',
      (() => {
        const { cwd: _cwd, ...rest } = fullRecord();
        return rest;
      })(),
      'cwd',
    ],
  ])('refuses %s and names %s', (_case, record, expectedPath) => {
    expect(() => deserializeSessionArtifact(artifactOf(record))).toThrow(
      new RegExp(expectedPath.replace(/[[\]().]/g, '\\$&')),
    );
  });

  it('reports an unsupported version without field issues — the two classes stay apart', () => {
    const future = JSON.stringify({ schemaVersion: 999, record: { total: 'garbage' } });
    expect(() => deserializeSessionArtifact(future)).toThrow(/schema version 999/);
    expect(() => deserializeSessionArtifact(future)).not.toThrow(/expected/);
  });

  it('reports bytes that are not JSON as an artifact failure, not a raw SyntaxError', () => {
    expect(() => deserializeSessionArtifact('{not json')).toThrow(/Invalid session artifact/);
  });

  it('bounds how many issues one message carries', () => {
    let thrown = '';
    try {
      // Four unknown keys plus five missing required members — comfortably past the cap.
      deserializeSessionArtifact(artifactOf({ a: 1, b: 2, c: 3, d: 4 }));
    } catch (error) {
      thrown = (error as Error).message;
    }
    expect(thrown).toMatch(/\(\+\d+ more\)/);
  });
});

describe('session artifact — one version constant, not two (TRANS-006)', () => {
  it('keeps the incumbent name and value on the public surface', () => {
    expect(SESSION_ARTIFACT_SCHEMA_VERSION).toBe(1);
    expect(JSON.parse(serializeSessionArtifact(fullRecord())).schemaVersion).toBe(
      SESSION_ARTIFACT_SCHEMA_VERSION,
    );
  });
});
