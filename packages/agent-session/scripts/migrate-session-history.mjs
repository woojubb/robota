#!/usr/bin/env node

/**
 * Backfill history for legacy session files; populated history is left unchanged.
 * Usage from this package: node scripts/migrate-session-history.mjs [--sessions-dir <absolute-directory>]
 * No arguments retain the production homedir()/.robota/sessions default.
 * Verification must always supply an explicit disposable directory.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const USAGE =
  'Usage: node scripts/migrate-session-history.mjs [--sessions-dir <absolute-directory>]';

function validateDirectory(sessionsDir) {
  if (typeof sessionsDir !== 'string' || !isAbsolute(sessionsDir) || sessionsDir.includes('\0')) {
    throw new Error(`sessionsDir must be an absolute directory. ${USAGE}`);
  }
}

/**
 * The single conversion implementation. Importing this module never reads storage.
 * @param {string} sessionsDir Explicit absolute session directory.
 * @returns {{missing: boolean, migrated: number, skipped: number, total: number}}
 */
export function migrateSessionHistory(sessionsDir) {
  validateDirectory(sessionsDir);
  if (!existsSync(sessionsDir)) {
    return { missing: true, migrated: 0, skipped: 0, total: 0 };
  }

  const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
  let migrated = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = join(sessionsDir, file);
    let record;
    try {
      record = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      skipped++;
      continue;
    }

    if (record.history && record.history.length > 0) {
      skipped++;
      continue;
    }
    if (!record.messages || record.messages.length === 0) {
      skipped++;
      continue;
    }

    // Preserve the historical conversion, including its message filter and timestamp source.
    record.history = record.messages
      .filter((m) => m.role && m.content)
      .map((m) => ({
        id: randomUUID(),
        timestamp: new Date(record.updatedAt ?? Date.now()).toISOString(),
        category: 'chat',
        type: m.role,
        data: { role: m.role, content: m.content },
      }));

    writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    migrated++;
  }

  return { missing: false, migrated, skipped, total: files.length };
}

function main(args) {
  // Validate the complete argument list before resolving the default or inspecting storage.
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--sessions-dir')) {
    throw new Error(USAGE);
  }
  if (args.length === 2) validateDirectory(args[1]);
  const sessionsDir = args.length === 0 ? join(homedir(), '.robota', 'sessions') : args[1];
  const result = migrateSessionHistory(sessionsDir);
  console.log(
    result.missing
      ? 'No sessions directory found.'
      : `Migration complete. Migrated: ${result.migrated}, Skipped: ${result.skipped}, Total: ${result.total}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
