/**
 * Sealing the subagent transcripts a host wrote in plaintext (#3679, secure conversation): every
 * parent's `subagents/` directory under the log root, each line one sealed record, so `/agent read`
 * pages the same lines at the same offsets before and after, and a parent entry that is a link is
 * never followed.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isSealedArtifactLine } from '@robota-sdk/agent-core';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  migrateSubagentTranscripts,
  readSubagentTranscriptPage,
  resolveSubagentTranscriptPath,
} from '../subagent-logger.js';

const CANARY = 'CANARY-5e02-subagent-saw-this';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function logRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-transcript-migration-')));
  roots.push(root);
  return join(root, 'logs');
}

/** A transcript as builds before sealing wrote it, with the empty and CRLF lines a page skips. */
function seedTranscript(base: string, parent: string, task: string): string {
  const path = resolveSubagentTranscriptPath(base, parent, task);
  mkdirSync(join(base, parent, 'subagents'), { recursive: true });
  const lines = Array.from({ length: 7 }, (_, index) =>
    JSON.stringify({ index, text: `${CANARY} ${index}` }),
  );
  writeFileSync(
    path,
    `${lines.slice(0, 3).join('\n')}\n\n${lines.slice(3, 5).join('\r\n')}\r\n\r\n${lines.slice(5).join('\n')}\n`,
  );
  return path;
}

/** Every page from every offset, as a reader sees them. */
function allPages(path: string, sealer?: ReturnType<typeof createTestArtifactSealer>) {
  return Array.from({ length: 9 }, (_, offset) =>
    readSubagentTranscriptPage(path, {
      offset,
      pageLines: 2,
      sealing: sealer === undefined ? 'plain' : { sealer },
    }),
  );
}

// agent-session's `openAppendFile` refuses every log on Windows, where `lstat` reports device 0 and
// `fstat` the volume serial for the same file, so these two cannot pass there until it is fixed (#3857).
const sealsOnThisPlatform = process.platform !== 'win32';

describe('migrateSubagentTranscripts', () => {
  it.skipIf(!sealsOnThisPlatform)(
    'seals every transcript in place, and every page keeps its lines and offsets',
    async () => {
      const base = logRoot();
      const first = seedTranscript(base, 'parent_a', 'task_1');
      const second = seedTranscript(base, 'parent_b', 'task_2');
      const sealer = createTestArtifactSealer();
      const before = allPages(first);

      const result = await migrateSubagentTranscripts(base, { sealer, apply: true });

      expect(result).toMatchObject({
        directories: 2,
        logs: 2,
        lines: 14,
        changed: [],
        refused: [],
      });
      for (const path of [first, second]) {
        const text = readFileSync(path, 'utf8');
        expect(text).not.toContain(CANARY);
        expect(
          text
            .split('\n')
            .filter((line) => line.length > 0)
            .every(isSealedArtifactLine),
        ).toBe(true);
      }
      expect(allPages(first, sealer)).toEqual(before);
    },
  );

  it.skipIf(!sealsOnThisPlatform)(
    'plans without writing, and a rerun finds everything sealed',
    async () => {
      const base = logRoot();
      const path = seedTranscript(base, 'parent_a', 'task_1');
      const sealer = createTestArtifactSealer();
      const plain = readFileSync(path);

      expect(await migrateSubagentTranscripts(base, { sealer, apply: false })).toMatchObject({
        logs: 1,
        lines: 7,
      });
      expect(readFileSync(path)).toEqual(plain);

      await migrateSubagentTranscripts(base, { sealer, apply: true });
      const sealed = readFileSync(path);
      expect(await migrateSubagentTranscripts(base, { sealer, apply: true })).toMatchObject({
        logs: 0,
        alreadySealed: 1,
      });
      expect(readFileSync(path)).toEqual(sealed);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'never follows a parent entry that is a link',
    async () => {
      const base = logRoot();
      const elsewhere = logRoot();
      const outside = seedTranscript(elsewhere, 'parent_x', 'task_9');
      mkdirSync(base, { recursive: true });
      symlinkSync(join(elsewhere, 'parent_x'), join(base, 'parent_x'));

      const result = await migrateSubagentTranscripts(base, {
        sealer: createTestArtifactSealer(),
        apply: true,
      });

      expect(result.refused).toEqual([join(base, 'parent_x')]);
      expect(readFileSync(outside, 'utf8')).toContain(CANARY);
    },
  );

  it('finds nothing under a log root that does not exist', async () => {
    expect(
      await migrateSubagentTranscripts(join(logRoot(), 'missing'), {
        sealer: createTestArtifactSealer(),
        apply: true,
      }),
    ).toMatchObject({ directories: 0, logs: 0, refused: [] });
  });
});
