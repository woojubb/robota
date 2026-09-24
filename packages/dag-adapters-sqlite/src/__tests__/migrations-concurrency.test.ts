import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('serializes concurrent constructors across separate SQLite connections', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dag-migration-race-'));
  const databasePath = join(root, 'runs.db');
  const startPath = join(root, 'start');
  const migrationsPath = fileURLToPath(new URL('../migrations.ts', import.meta.url));
  const sqliteModulePath = createRequire(import.meta.url).resolve('better-sqlite3');
  const childSource = `
    import Database from ${JSON.stringify(sqliteModulePath)};
    import { existsSync, writeFileSync } from 'node:fs';
    import { runMigrations } from ${JSON.stringify(migrationsPath)};
    const [databasePath, readyPath, startPath] = process.argv.slice(1);
    writeFileSync(readyPath, 'ready');
    while (!existsSync(startPath)) await new Promise((resolve) => setTimeout(resolve, 1));
    const db = new Database(databasePath);
    try { runMigrations(db); } finally { db.close(); }
  `;
  const children = Array.from({ length: 4 }, (_, index) => {
    const readyPath = join(root, `ready-${index}`);
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        childSource,
        databasePath,
        readyPath,
        startPath,
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const completed = new Promise<string>((resolve) => {
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('close', (code) => resolve(code === 0 ? '' : stderr || `exit ${code}`));
    });
    return { child, readyPath, completed };
  });
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !children.every(({ readyPath }) => existsSync(readyPath))) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(children.every(({ readyPath }) => existsSync(readyPath))).toBe(true);
    writeFileSync(startPath, 'go');
    expect(await Promise.all(children.map(({ completed }) => completed))).toEqual(['', '', '', '']);
    const db = new Database(databasePath);
    try {
      expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
        { version: 1 },
        { version: 2 },
      ]);
    } finally {
      db.close();
    }
  } finally {
    for (const { child } of children) child.kill();
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
