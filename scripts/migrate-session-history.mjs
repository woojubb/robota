#!/usr/bin/env node

/**
 * One-time migration: add history field to session files that only have messages.
 *
 * Converts messages[] → history[] (IHistoryEntry format) so that
 * session resume can display previous conversations.
 *
 * Safe to run multiple times — skips sessions that already have history.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const sessionsDir = join(homedir(), '.robota', 'sessions');

if (!existsSync(sessionsDir)) {
  console.log('No sessions directory found.');
  process.exit(0);
}

const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
let migrated = 0;
let skipped = 0;

for (const file of files) {
  const filePath = join(sessionsDir, file);
  const record = JSON.parse(readFileSync(filePath, 'utf8'));

  if (record.history && record.history.length > 0) {
    skipped++;
    continue;
  }

  if (!record.messages || record.messages.length === 0) {
    skipped++;
    continue;
  }

  // Convert messages to IHistoryEntry format
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

console.log(
  `Migration complete. Migrated: ${migrated}, Skipped: ${skipped}, Total: ${files.length}`,
);
