#!/usr/bin/env node

/**
 * Run from this package: node examples/verify-session-history-migration.mjs
 * Executes the real migration command against disposable explicit storage only.
 * No HOME override, default storage invocation or duplicate migration algorithm.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/migrate-session-history.mjs', import.meta.url));
const fixture = mkdtempSync(join(tmpdir(), 'robota-session-migration-example-'));

function run(sessionsDir) {
  const output = execFileSync(process.execPath, [script, '--sessions-dir', sessionsDir], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 10000,
  });
  process.stdout.write(output);
  return output;
}

try {
  const sessionsDir = join(fixture, 'sessions with spaces');
  mkdirSync(sessionsDir);
  const messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world' },
  ];
  const samples = {
    'legacy.json': JSON.stringify({ updatedAt: '2026-01-01T00:00:00Z', messages }),
    'existing.json': JSON.stringify({
      messages,
      history: [{ id: 'retained', category: 'chat', type: 'user', data: {} }],
    }),
    'empty.json': JSON.stringify({ messages: [] }),
    'malformed.json': '{invalid json',
    'sentinel.txt': 'not a JSON session\n',
  };
  for (const [name, contents] of Object.entries(samples))
    writeFileSync(join(sessionsDir, name), contents);

  assert.match(run(sessionsDir), /Migrated: 1, Skipped: 3, Total: 4/);
  const migrated = JSON.parse(readFileSync(join(sessionsDir, 'legacy.json'), 'utf8'));
  assert.deepEqual(migrated.messages, messages);
  assert.equal(migrated.history.length, 2);
  for (const [index, entry] of migrated.history.entries()) {
    assert.match(
      entry.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(entry.timestamp, '2026-01-01T00:00:00.000Z');
    assert.equal(entry.category, 'chat');
    assert.equal(entry.type, messages[index].role);
    assert.deepEqual(entry.data, messages[index]);
  }
  assert.notEqual(migrated.history[0].id, migrated.history[1].id);
  console.log('Migrated history:', JSON.stringify(migrated.history, null, 2));

  for (const [name, contents] of Object.entries(samples)) {
    if (name !== 'legacy.json')
      assert.deepEqual(readFileSync(join(sessionsDir, name)), Buffer.from(contents));
  }
  console.log('Skipped files and sentinel: byte-identical');

  const firstBytes = Object.keys(samples).map((name) => [
    name,
    readFileSync(join(sessionsDir, name)),
  ]);
  assert.match(run(sessionsDir), /Migrated: 0, Skipped: 4, Total: 4/);
  for (const [name, bytes] of firstBytes)
    assert.deepEqual(readFileSync(join(sessionsDir, name)), bytes);
  console.log('Repeated migration: all fixture bytes identical');

  const missing = join(fixture, 'missing');
  assert.equal(run(missing).trim(), 'No sessions directory found.');
  assert.equal(existsSync(missing), false);
  console.log('Missing directory remains absent');
} finally {
  rmSync(fixture, { recursive: true, force: true });
  console.log(`Fixture removed: ${fixture}`);
}
