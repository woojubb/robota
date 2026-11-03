/**
 * `session list` and sealed sessions whose keys are locked: they are not listed (a record that cannot
 * be read has nothing to show), but the listing must not read as "nothing saved" — it says how many
 * are there. With none sealed, the output is what it always was.
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
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

function sealedStores(ids: readonly string[]) {
  const sealer = createTestArtifactSealer();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'session-list-locked-')));
  const store = createNodeHostSessionStore(dir, undefined, { sealing: { sealer } });
  for (const id of ids) store.save(record(id));
  return { store, sealer, dir };
}

describe('session list with sealed sessions', () => {
  it('says how many sealed sessions are locked, in text and in json, and still shows the rest', () => {
    const { store, sealer } = sealedStores(['sess_a', 'sess_b']);
    sealer.lock();

    const text = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: store,
      readPeers: NO_PEERS,
    });
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain('Saved sessions (not linked to live processes):');
    expect(text.stdout).toContain('2 saved sessions are sealed and locked; unlock to open them.');
    expect(text.stdout).not.toContain('sess_a');

    const json = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: store,
      readPeers: NO_PEERS,
    });
    expect(JSON.parse(json.stdout)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      locked: 2,
    });
  });

  it('counts sessions sealed with keys this process does not have apart, never saying to unlock them', () => {
    const plain = createNodeHostSessionStore(sealedStores(['sess_a']).dir, undefined, {
      sealing: 'plain',
    });
    const text = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: plain,
      readPeers: NO_PEERS,
    });
    expect(text.stdout).toContain(
      '1 saved session is sealed with keys this process does not have.',
    );
    expect(text.stdout).not.toMatch(/unlock/i);
    const json = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: plain,
      readPeers: NO_PEERS,
    });
    expect(JSON.parse(json.stdout)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      noKeys: 1,
    });
  });

  it('counts the user and the project store together', () => {
    const user = sealedStores(['sess_a']);
    const project = sealedStores(['sess_b']);
    user.sealer.lock();
    project.sealer.lock();
    const result = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: user.store,
      projectSessionStore: project.store,
      readPeers: NO_PEERS,
    });
    expect(JSON.parse(result.stdout).locked).toBe(2);
  });

  it('adds nothing when no session is sealed and locked', () => {
    const { store } = sealedStores(['sess_a']);
    const json = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: store,
      readPeers: NO_PEERS,
    });
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['live', 'saved']);
    expect(parsed['saved']).toEqual([{ id: 'sess_a', availability: 'valid', source: 'user' }]);
    const text = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: store,
      readPeers: NO_PEERS,
    });
    expect(text.stdout).not.toContain('sealed');
  });
});
