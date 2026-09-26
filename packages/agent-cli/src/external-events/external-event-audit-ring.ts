import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
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

function writeAll(fd: number, bytes: Buffer): void {
  let written = 0;
  while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
}

/**
 * Move what the open trail holds into a freshly created previous file, then empty the trail.
 * Everything goes through `fd`, the file already open and checked, so the path is never
 * resolved a second time and nothing swapped in at it can be rotated or written.
 *
 * Copy-then-truncate relies on one writer per trail: the serve process of that one session,
 * writing synchronously, so nothing appends between the copy and the truncate. A second writer
 * could lose the lines it appended in that gap.
 */
function rotate(fd: number, previous: string): void {
  rmSync(previous, { force: true });
  const out = openSync(
    previous,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let position = 0;
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, position);
      if (read === 0) break;
      writeAll(out, chunk.subarray(0, read));
      position += read;
    }
  } finally {
    closeSync(out);
  }
  ftruncateSync(fd, 0);
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
      const fd = openSync(
        current,
        constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const bytes = Buffer.from(text);
        if (fstatSync(fd).size + bytes.length > MAX_FILE_BYTES) rotate(fd, previous);
        writeAll(fd, bytes);
      } finally {
        closeSync(fd);
      }
    } catch {
      // Best effort by design.
    }
  };
}
