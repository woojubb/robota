/**
 * Runs the owner migration command with explicit disposable storage, without HOME overrides.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/migrate-session-history.mjs', import.meta.url));

function createSessionFile(dir: string, name: string, data: Record<string, unknown>): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function runMigration(sessionsDir: string): string {
  return execFileSync(process.execPath, [script, '--sessions-dir', sessionsDir], {
    cwd: sessionsDir,
    encoding: 'utf8',
  });
}

describe('migrate-session-history', () => {
  let tmpDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'robota-session-migration-'));
    sessionsDir = join(tmpDir, 'sessions with spaces');
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates session without history field', () => {
    createSessionFile(sessionsDir, 'sess1.json', {
      id: 'sess1',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    });

    const output = runMigration(sessionsDir);
    expect(output).toContain('Migrated: 1');

    const result = JSON.parse(readFileSync(join(sessionsDir, 'sess1.json'), 'utf8'));
    expect(result.history).toHaveLength(2);
    expect(result.history[0].category).toBe('chat');
    expect(result.history[0].type).toBe('user');
    expect(result.history[1].type).toBe('assistant');
    expect(result.history[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(result.history[0].data).toEqual({ role: 'user', content: 'hello' });
    expect(result.history[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]);
  });

  it('skips session that already has history', () => {
    createSessionFile(sessionsDir, 'sess2.json', {
      id: 'sess2',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user', content: 'hello' }],
      history: [{ id: '1', category: 'chat', type: 'user', data: {} }],
    });

    const output = runMigration(sessionsDir);
    expect(output).toContain('Skipped: 1');
  });

  it('skips session with empty messages', () => {
    createSessionFile(sessionsDir, 'sess3.json', {
      id: 'sess3',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      messages: [],
    });

    const output = runMigration(sessionsDir);
    expect(output).toContain('Skipped: 1');
  });

  it('skips malformed JSON files without crashing', () => {
    writeFileSync(join(sessionsDir, 'bad.json'), '{invalid json', 'utf8');
    createSessionFile(sessionsDir, 'good.json', {
      id: 'good',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user', content: 'test' }],
    });

    const output = runMigration(sessionsDir);
    expect(output).toContain('Migrated: 1');
    expect(output).toContain('Skipped: 1');
  });

  it('is idempotent — running twice produces same result', () => {
    createSessionFile(sessionsDir, 'sess4.json', {
      id: 'sess4',
      cwd: '/tmp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      messages: [{ role: 'user', content: 'hello' }],
    });

    runMigration(sessionsDir);
    const firstRun = JSON.parse(readFileSync(join(sessionsDir, 'sess4.json'), 'utf8'));

    const output = runMigration(sessionsDir);
    expect(output).toContain('Skipped: 1');

    const secondRun = JSON.parse(readFileSync(join(sessionsDir, 'sess4.json'), 'utf8'));
    expect(secondRun.history).toEqual(firstRun.history);
  });
  it('does not create missing explicitly selected storage', () => {
    const missing = join(tmpDir, 'missing');
    const output = execFileSync(process.execPath, [script, '--sessions-dir', missing], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    expect(output.trim()).toBe('No sessions directory found.');
    expect(existsSync(missing)).toBe(false);
  });

  it.each([
    ['--unknown'],
    ['--sessions-dir'],
    ['--sessions-dir', 'relative'],
    ['--sessions-dir', ''],
    ['--sessions-dir', '/unused', '--sessions-dir', '/unused'],
    ['--sessions-dir', '/unused', '--unknown'],
    ['unexpected-positional'],
  ])('rejects invalid arguments before reading storage: %j', (...args: string[]) => {
    const legacy = createSessionFile(sessionsDir, 'untouched.json', {
      messages: [{ role: 'user', content: 'do not migrate' }],
    });
    const before = readFileSync(legacy);
    const actualArgs = args.map((arg) => (arg === '/unused' ? sessionsDir : arg));
    const result = spawnSync(process.execPath, [script, ...actualArgs], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).toBe('');
    expect(readFileSync(legacy)).toEqual(before);
  });

  it('accepts an explicit directory through its side-effect-free callable entry', () => {
    createSessionFile(sessionsDir, 'callable.json', {
      messages: [{ role: 'user', content: 'direct' }],
    });
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'const { migrateSessionHistory } = await import(process.argv[1]); console.log(JSON.stringify(migrateSessionHistory(process.argv[2])));',
        new URL('../../scripts/migrate-session-history.mjs', import.meta.url).href,
        sessionsDir,
      ],
      { cwd: tmpDir, encoding: 'utf8' },
    );
    expect(JSON.parse(result)).toEqual({ missing: false, migrated: 1, skipped: 0, total: 1 });
  });

  it('runs the observable fixture example and reports byte preservation and cleanup', () => {
    const example = fileURLToPath(
      new URL('../../examples/verify-session-history-migration.mjs', import.meta.url),
    );
    const output = execFileSync(process.execPath, [example], { cwd: tmpDir, encoding: 'utf8' });
    expect(output).toContain('Migrated: 1, Skipped: 3, Total: 4');
    expect(output).toContain('Migrated: 0, Skipped: 4, Total: 4');
    expect(output).toContain('No sessions directory found.');
    expect(output).toContain('Skipped files and sentinel: byte-identical');
    expect(output).toContain('Repeated migration: all fixture bytes identical');
    const match = output.match(/Fixture removed: (.+)/);
    expect(match).not.toBeNull();
    expect(existsSync(match![1])).toBe(false);
  });
});
