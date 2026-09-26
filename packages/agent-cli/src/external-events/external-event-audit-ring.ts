import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';

import type { TExternalEventAuditRecord } from '@robota-sdk/agent-interface-transport';

/** Bytes one session's current audit file may hold before it is rotated to its one previous file. */
const MAX_FILE_BYTES = 256 * 1024;
/** Audit files kept across sessions; the oldest beyond this are removed when a new ring opens. */
const MAX_FILES = 64;
const ID_PATTERN = /^[0-9a-f-]{36}$/u;

/** Exactly the fields a record may carry, so nothing else a caller attached is ever written. */
function line(record: TExternalEventAuditRecord): string {
  return `${JSON.stringify({
    at: record.at,
    ...(record.grantId !== undefined ? { grantId: record.grantId } : {}),
    ...('refusal' in record ? { refusal: record.refusal } : { settlement: record.settlement }),
    ...(record.remote !== undefined ? { remote: record.remote } : {}),
    ...(record.throttled !== undefined ? { throttled: record.throttled } : {}),
  })}\n`;
}

function pruneOldest(directory: string): void {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      try {
        return { name, at: lstatSync(join(directory, name)).mtimeMs };
      } catch {
        return undefined;
      }
    })
    .filter((file): file is { name: string; at: number } => file !== undefined)
    .sort((a, b) => b.at - a.at);
  for (const file of files.slice(MAX_FILES)) rmSync(join(directory, file.name), { force: true });
}

/**
 * A bounded, owner-only JSONL trail of one supervised session's external-event refusals and
 * settlements. It outlives the process, so a refusal can be seen after the fact. `directory` must
 * already be private to this user. A write that fails is dropped: the trail never blocks a decision.
 */
export function createExternalEventAuditRing(
  directory: string,
  sessionId: string,
): (record: TExternalEventAuditRecord) => void {
  if (!ID_PATTERN.test(sessionId)) throw new Error('Invalid supervised session ID.');
  const current = join(directory, `${sessionId}.jsonl`);
  const previous = join(directory, `${sessionId}.1.jsonl`);
  try {
    pruneOldest(directory);
  } catch {
    // An unreadable directory only means nothing was pruned.
  }
  return (record) => {
    const text = line(record);
    try {
      let fd = openSync(
        current,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      if (fstatSync(fd).size + Buffer.byteLength(text) > MAX_FILE_BYTES) {
        closeSync(fd);
        renameSync(current, previous);
        fd = openSync(
          current,
          constants.O_WRONLY |
            constants.O_APPEND |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
      }
      try {
        writeSync(fd, text);
      } finally {
        closeSync(fd);
      }
    } catch {
      // Best effort by design.
    }
  };
}
