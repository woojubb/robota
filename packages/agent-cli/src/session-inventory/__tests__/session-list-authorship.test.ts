/**
 * `session list` over a store that seals (#3679): each saved record says whose it is, and records
 * nobody vouched for come after every other, never ranked among them. Over a plain store the output
 * says nothing of authorship.
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { SESSION_RECORD_ENVELOPE_VERSION } from '@robota-sdk/agent-session';
import { describe, expect, it } from 'vitest';

import { executeSessionListCommand } from '../session-list-command.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    messages: [],
  };
}

const NO_PEERS = () => ({ status: 'available', peers: [] }) as const;

function directory(): string {
  return join(realpathSync(mkdtempSync(join(tmpdir(), 'session-list-authorship-'))), 'sessions');
}

describe('session list over a store that seals', () => {
  it('marks whose each record is in json, and lists unverified records after every verified one', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const store = createNodeHostSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_b_mine'), { provenance: 'owner' });
    store.save(record('sess_c_mine'), { provenance: 'owner' });
    // Planted with the public side alone, and named to sort first.
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'sess_a_planted.json'),
      openTestWriteGrant(sealer.writeGrant()).sealBytes(
        Buffer.from(
          JSON.stringify({
            schemaVersion: SESSION_RECORD_ENVELOPE_VERSION,
            record: record('sess_a_planted'),
          }),
        ),
        { kind: 'session-record', id: 'sess_a_planted' },
      ),
    );
    const reader = createNodeHostSessionStore(dir, { sealing: { sealer } });

    const json = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: reader,
      readPeers: NO_PEERS,
    });
    const text = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: reader,
      readPeers: NO_PEERS,
    });

    expect(JSON.parse(json.stdout).saved).toEqual([
      { id: 'sess_b_mine', availability: 'valid', source: 'user', authorship: 'verified' },
      { id: 'sess_c_mine', availability: 'valid', source: 'user', authorship: 'verified' },
      { id: 'sess_a_planted', availability: 'valid', source: 'user', authorship: 'unverified' },
    ]);
    expect(text.stdout).toContain(
      [
        '  "sess_b_mine"  valid  user',
        '  "sess_c_mine"  valid  user',
        '  "sess_a_planted"  valid  user  unverified',
      ].join('\n'),
    );
  });
});

describe('session list over a store that never seals', () => {
  it('prints the listing with no authorship in it', () => {
    const store = createNodeHostSessionStore(directory(), { sealing: 'plain' });
    store.save(record('sess_b'));
    store.save(record('sess_a'));

    const json = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: store,
      readPeers: NO_PEERS,
    });
    const text = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: store,
      readPeers: NO_PEERS,
    });

    expect(json.stdout).toBe(
      '{"live":{"status":"available","processes":[]},"saved":[' +
        '{"id":"sess_a","availability":"valid","source":"user"},' +
        '{"id":"sess_b","availability":"valid","source":"user"}]}\n',
    );
    expect(text.stdout).toBe(
      [
        'Live processes (not linked to saved sessions):',
        '  (none)',
        'Saved sessions (not linked to live processes):',
        '  "sess_a"  valid  user',
        '  "sess_b"  valid  user',
        '',
      ].join('\n'),
    );
  });
});
