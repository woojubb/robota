import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { scrubSensitiveKeys } from '../scrub-sensitive.js';
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  deserializeSessionArtifact,
  serializeSessionArtifact,
} from '../session-artifact.js';
import { SessionStore } from '../session-store.js';

import type { ISessionRecord } from '../session-store.js';

/**
 * SELFHOST-014 — the export/import artifact envelope over the storage-neutral ISessionRecord.
 */

function fullRecord(): ISessionRecord {
  return {
    id: 'sess_1',
    name: 'demo',
    cwd: '/work/project',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T01:00:00.000Z',
    messages: [{ role: 'user', content: 'hi', apiKey: 'sk-leak' }],
    history: [{ type: 'chat', text: 'hi' }],
    systemPrompt: 'you are helpful',
    backgroundTasks: [{ id: 'bg_1', status: 'sleeping' }],
    backgroundTaskEvents: [{ type: 'background_task_created' }],
    goal: { objective: 'ship', status: 'active' },
    contextReferences: [{ path: 'AGENTS.md' }],
    sandboxSnapshotId: 'snap_1',
  } as unknown as ISessionRecord;
}

function newStore(): SessionStore {
  return new SessionStore(mkdtempSync(path.join(tmpdir(), 'artifact-store-')));
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
});

describe('session artifact — export-for-share redact seam (TC-07)', () => {
  it('applies an app-supplied redact (strip cwd/sandboxSnapshotId + scrub secrets); no-redact keeps them', () => {
    const record = fullRecord();
    // App-owned FIELD policy lives here (in the test = the app), never in the library.
    const redact = (r: ISessionRecord): ISessionRecord => {
      const {
        cwd: _cwd,
        sandboxSnapshotId: _snap,
        ...rest
      } = r as ISessionRecord & {
        cwd?: string;
        sandboxSnapshotId?: string;
      };
      return scrubSensitiveKeys(rest) as ISessionRecord;
    };

    const shared = deserializeSessionArtifact(serializeSessionArtifact(record, { redact }));
    expect(shared.cwd).toBeUndefined();
    expect((shared as { sandboxSnapshotId?: string }).sandboxSnapshotId).toBeUndefined();
    expect((shared.messages[0] as { apiKey: string }).apiKey).toBe('[REDACTED]');

    // Without redact, the full-fidelity form retains everything (op 1 ≠ op 2).
    const full = deserializeSessionArtifact(serializeSessionArtifact(record));
    expect(full.cwd).toBe('/work/project');
    expect((full.messages[0] as { apiKey: string }).apiKey).toBe('sk-leak');
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
    expect(onB?.messages).toEqual(record.messages);
    expect(onB?.history).toEqual(record.history);
    expect(onB?.goal).toEqual(record.goal);
    // Stores are independent — B has it, and they do not share storage.
    expect(storeA.getFilePath(record.id)).not.toBe(storeB.getFilePath(record.id));
  });
});

describe('session artifact — a REDACTED artifact still resumes on B with import-side rebind (TC-08)', () => {
  it('redact strips required cwd → import on B → app rebinds B cwd → resumes with content intact', () => {
    const record = fullRecord();
    const redactStripCwd = (r: ISessionRecord): ISessionRecord => {
      const { cwd: _cwd, ...rest } = r as ISessionRecord & { cwd?: string };
      return rest as ISessionRecord;
    };
    const artifact = serializeSessionArtifact(record, { redact: redactStripCwd });

    const imported = deserializeSessionArtifact(artifact);
    expect(imported.cwd).toBeUndefined(); // required field was stripped on the share path

    // The IMPORT/APP layer on surface B rebinds the stripped required field with B's own cwd.
    const storeB = newStore();
    storeB.save({ ...imported, cwd: '/surface-b/checkout' });

    const onB = storeB.load(record.id);
    expect(onB?.cwd).toBe('/surface-b/checkout'); // rebound
    expect(onB?.messages).toEqual(record.messages); // content intact
    expect(onB?.history).toEqual(record.history);
    expect(onB?.goal).toEqual(record.goal);
  });
});
