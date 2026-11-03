/**
 * `usage` and `usage export` with sealed sessions whose keys are locked. The totals cover readable
 * sessions only, so a report that stayed silent would read as the whole picture; and an export of
 * part of the sessions is refused the same way an export with unreadable records already is.
 */
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';
import { describe, expect, it, vi } from 'vitest';

import {
  createPersonalUsageReporter,
  createStoredSessionUsageReporter,
  executeUsageCommand,
} from '../usage-command.js';
import { executeUsageExportCommand } from '../usage-export-command.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    messages: [],
    history: [],
  };
}

function lockedStore(ids: readonly string[]) {
  const sealer = createTestArtifactSealer();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'usage-locked-')));
  const store = createNodeHostSessionStore(dir, undefined, { sealing: { sealer } });
  for (const id of ids) store.save(record(id));
  sealer.lock();
  return store;
}

describe('usage with sealed sessions', () => {
  it('reports what it can read and says that locked sessions are not in the totals', () => {
    const result = executeUsageCommand(
      ['--format', 'json'],
      {
        userSessionStore: lockedStore(['sess_a', 'sess_b']),
        now: new Date('2026-09-06T00:00:00Z'),
      },
      'test-product',
    );
    expect(result.exitCode).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stderr).toBe(
      'Usage excludes 2 saved sessions that are sealed and locked; unlock to include them.\n',
    );
  });

  it('carries the locked count in the report itself, for a reader of the JSON or the text', () => {
    const json = executeUsageCommand(
      ['--format', 'json'],
      {
        userSessionStore: lockedStore(['sess_a', 'sess_b']),
        now: new Date('2026-09-06T00:00:00Z'),
      },
      'test-product',
    );
    expect(JSON.parse(json.stdout).coverage.lockedSessions).toBe(2);
    const text = executeUsageCommand(
      [],
      { userSessionStore: lockedStore(['sess_a']), now: new Date('2026-09-06T00:00:00Z') },
      'test-product',
    );
    expect(text.stdout).toContain('locked 1');
  });

  it('uses the singular for one session', () => {
    const result = executeUsageCommand(
      [],
      { userSessionStore: lockedStore(['sess_a']), now: new Date('2026-09-06T00:00:00Z') },
      'test-product',
    );
    expect(result.stderr).toBe(
      'Usage excludes 1 saved session that is sealed and locked; unlock to include it.\n',
    );
  });

  it('says nothing extra when no session is locked', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'usage-unlocked-')));
    const store = createNodeHostSessionStore(dir, undefined, { sealing: 'plain' });
    store.save(record('sess_a'));
    const result = executeUsageCommand([], { userSessionStore: store }, 'test-product');
    expect(result.stderr).toBe('');
  });

  it('refuses to export a partial snapshot while sessions are locked, and sends nothing', async () => {
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      serviceName: 'test-product',
      userSessionStore: lockedStore(['sess_a']),
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('sealed records that are locked');
    expect(result.stderr).toContain('no incomplete snapshot was sent'.replace('no', 'No'));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('usage with sessions sealed with keys this process does not have', () => {
  function noKeysStore(ids: readonly string[]) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'usage-no-keys-')));
    const writer = createNodeHostSessionStore(dir, undefined, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    for (const id of ids) writer.save(record(id));
    return createNodeHostSessionStore(dir, undefined, { sealing: 'plain' });
  }

  it('says they are not in the totals without telling anyone to unlock', () => {
    const result = executeUsageCommand(
      ['--format', 'json'],
      {
        userSessionStore: noKeysStore(['sess_a', 'sess_b']),
        now: new Date('2026-09-06T00:00:00Z'),
      },
      'test-product',
    );
    expect(result.stderr).toBe(
      'Usage excludes 2 saved sessions sealed with keys this process does not have.\n',
    );
    expect(JSON.parse(result.stdout).coverage.lockedSessions).toBe(2);
  });

  it('refuses to export a partial snapshot, without telling anyone to unlock', async () => {
    const fetcher = vi.fn();
    const result = await executeUsageExportCommand(['--endpoint', 'http://127.0.0.1:4318'], {
      serviceName: 'test-product',
      userSessionStore: noKeysStore(['sess_a']),
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'Stored sessions include sealed records this process has no keys for. No incomplete snapshot was sent.\n',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('the personal usage reporter a served runtime answers with', () => {
  it('counts the sealed sessions it could not include', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'usage-personal-')));
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const sessions = join(home, '.test-product', 'sessions');
    createNodeHostSessionStore(sessions, undefined, {
      sealing: { sealer: createTestArtifactSealer() },
    }).save(record('sess_a'));

    // The reporter builds its own store, which holds no keys: the sealed file is `locked` to it.
    const report = createPersonalUsageReporter(runtime)({ period: '7d', timezone: 'UTC' });

    expect(report.coverage.lockedSessions).toBe(1);
  });
});

describe('the stored-session usage reporter', () => {
  it('says a sealed session is locked instead of saying it cannot be analyzed', () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'usage-reporter-')));
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const sealer = createTestArtifactSealer();
    const sessions = join(home, '.test-product', 'sessions');
    createNodeHostSessionStore(sessions, undefined, { sealing: { sealer } }).save(record('sess_a'));

    // The reporter builds its own store with no keys, so no unlock in this process would open it.
    expect(() => createStoredSessionUsageReporter(runtime)('sess_a')).toThrow(
      'Session sess_a is sealed with keys this process does not have.',
    );
    expect(() => createStoredSessionUsageReporter(runtime)('sess_none')).toThrow(
      'Session sess_none was not found.',
    );
  });
});
