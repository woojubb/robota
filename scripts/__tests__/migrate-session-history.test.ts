/**
 * Tests for migrate-session-history.mjs logic.
 * Tests the migration algorithm, not the script runner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

function createSessionFile(dir: string, name: string, data: Record<string, unknown>): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return filePath;
}

function runMigration(homeDir: string): string {
  return execSync(`node scripts/migrate-session-history.mjs`, {
    cwd: process.cwd(),
    env: { ...process.env, HOME: homeDir },
    encoding: 'utf8',
  });
}

describe('migrate-session-history', () => {
  let tmpDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'migrate-test-'));
    sessionsDir = join(tmpDir, '.robota', 'sessions');
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

    const output = runMigration(tmpDir);
    expect(output).toContain('Migrated: 1');

    const result = JSON.parse(readFileSync(join(sessionsDir, 'sess1.json'), 'utf8'));
    expect(result.history).toHaveLength(2);
    expect(result.history[0].category).toBe('chat');
    expect(result.history[0].type).toBe('user');
    expect(result.history[1].type).toBe('assistant');
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

    const output = runMigration(tmpDir);
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

    const output = runMigration(tmpDir);
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

    const output = runMigration(tmpDir);
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

    runMigration(tmpDir);
    const firstRun = JSON.parse(readFileSync(join(sessionsDir, 'sess4.json'), 'utf8'));

    const output = runMigration(tmpDir);
    expect(output).toContain('Skipped: 1');

    const secondRun = JSON.parse(readFileSync(join(sessionsDir, 'sess4.json'), 'utf8'));
    expect(secondRun.history).toEqual(firstRun.history);
  });
});
