/**
 * Compacting the prompt-history file (#3679, secure conversation): every entry, plain or sealed,
 * rewritten one per line under the one sealer it is given, swapped in by rename while terminals may
 * still be appending by path. The snapshot ends at the last newline, what is appended meanwhile is
 * caught up from the replaced file, what does not open is carried over as it is, and a plain line
 * that reaches the new file anyway is reported, never hidden.
 */
import {
  appendFileSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compactPromptHistoryFile,
  inspectPromptHistoryFile,
} from '../prompt-history-compaction.js';
import { NodePromptHistoryFile, PROMPT_HISTORY_OWNER_ID } from '../prompt-history-file.js';
import { StoredLines } from '../stored-append-lines.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type { IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-31d7-typed-prompt';
const roots: string[] = [];
const NO_PAUSE = async (): Promise<void> => {};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-prompt-history-compaction-')));
  roots.push(root);
  return root;
}

function entry(index: number): IPromptHistoryEntry {
  return {
    at: `2026-11-03T00:${String(index).padStart(2, '0')}:00.000Z`,
    sessionId: `s${index % 3}`,
    project: '/work',
    text: `${CANARY} ${index}`,
  };
}

const line = (index: number): string => `${JSON.stringify(entry(index))}\n`;

async function readTexts(path: string, sealer: IArtifactSealer): Promise<string[]> {
  const texts: string[] = [];
  const file = new NodePromptHistoryFile(path, { sealing: { sealer } });
  for await (const block of file.read({ signal: new AbortController().signal })) {
    texts.push(...block.entries.map((item) => item.text));
    expect(block.skippedLines).toBe(0);
  }
  return texts.reverse();
}

function physicalLines(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').slice(0, -1);
}

/** A history holding plain lines, single sealed appends and one sealed record of two lines. */
function mixedHistory(path: string, sealer: IArtifactSealer): void {
  writeFileSync(path, line(1) + line(2), { mode: 0o600 });
  new NodePromptHistoryFile(path, { sealing: { sealer } }).append(entry(3));
  appendFileSync(
    path,
    new StoredLines({ sealer }, 'prompt-history-line').encode(
      line(4) + line(5),
      PROMPT_HISTORY_OWNER_ID,
    ),
  );
  appendFileSync(path, line(6));
}

describe('compactPromptHistoryFile', () => {
  it('seals every entry, plain or sealed, one per line, and the reader returns the same entries', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    const sealer = createTestArtifactSealer();
    mixedHistory(path, sealer);

    const result = await compactPromptHistoryFile(path, { sealer, pause: NO_PAUSE });

    expect(result).toEqual({
      status: 'compacted',
      entries: 6,
      fromPlain: 3,
      caughtUp: 0,
      carriedOver: 0,
      droppedTail: false,
      plainLinesAfter: 0,
    });
    const lines = physicalLines(path);
    expect(lines).toHaveLength(6);
    for (const stored of lines) expect(stored.startsWith('RSL1:')).toBe(true);
    expect(readFileSync(path, 'utf8')).not.toContain(CANARY);
    expect(await readTexts(path, sealer)).toEqual([1, 2, 3, 4, 5, 6].map((i) => entry(i).text));
    expect(readdirSync(root)).toEqual(['history.jsonl']);
    if (process.platform !== 'win32') expect(lstatSync(path).mode & 0o777).toBe(0o600);
  });

  it('snapshots up to the last newline, so a line still being written is caught up whole', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    const third = line(3);
    const cut = Math.floor(third.length / 2);
    writeFileSync(path, line(1) + line(2) + third.slice(0, cut));

    const result = await compactPromptHistoryFile(path, {
      sealer,
      pause: NO_PAUSE,
      beforeCommit: () => appendFileSync(path, third.slice(cut)),
    });

    expect(result).toMatchObject({ status: 'compacted', entries: 3, caughtUp: 1 });
    expect(await readTexts(path, sealer)).toEqual([1, 2, 3].map((i) => entry(i).text));
  });

  it('keeps an entry appended while it compacts, which a plain rename would lose', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    writeFileSync(path, line(1) + line(2));

    // Appended by path after the snapshot and before the rename: it lands in the file being replaced.
    const result = await compactPromptHistoryFile(path, {
      sealer,
      pause: NO_PAUSE,
      beforeCommit: () => appendFileSync(path, line(3)),
    });

    expect(result).toMatchObject({ status: 'compacted', entries: 3, fromPlain: 3, caughtUp: 1 });
    expect(await readTexts(path, sealer)).toEqual([1, 2, 3].map((i) => entry(i).text));
    expect(readFileSync(path, 'utf8')).not.toContain(CANARY);
  });

  it('catches up what a writer that opened the old file before the rename appends after it', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    writeFileSync(path, line(1));
    const writer = openSync(path, 'a');
    let pauses = 0;
    try {
      const result = await compactPromptHistoryFile(path, {
        sealer,
        pause: async () => {
          pauses += 1;
          if (pauses === 1) writeSync(writer, line(2));
        },
      });

      expect(result).toMatchObject({ status: 'compacted', entries: 2, caughtUp: 1 });
    } finally {
      closeSync(writer);
    }
    expect(await readTexts(path, sealer)).toEqual([1, 2].map((i) => entry(i).text));
  });

  it('reports a plain line that reaches the new file during the catch-up', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    writeFileSync(path, line(1));
    let pauses = 0;

    // An older build appends by path after the rename: its plaintext lands in the new file.
    const result = await compactPromptHistoryFile(path, {
      sealer,
      pause: async () => {
        pauses += 1;
        if (pauses === 1) appendFileSync(path, line(2));
      },
    });

    expect(result).toMatchObject({ status: 'compacted', plainLinesAfter: 1 });
  });

  it('abandons its rename when another compaction replaced the history first, losing nothing of it', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    const sealer = createTestArtifactSealer();
    writeFileSync(path, line(1));
    // What a second compaction that started meanwhile renamed in, holding an entry appended since.
    const theirs = line(1) + line(2);

    const result = await compactPromptHistoryFile(path, {
      sealer,
      pause: NO_PAUSE,
      beforeCommit: () => {
        writeFileSync(join(root, 'theirs.tmp'), theirs);
        renameSync(join(root, 'theirs.tmp'), path);
      },
    });

    expect(result).toEqual({ status: 'replaced' });
    expect(readFileSync(path, 'utf8')).toBe(theirs);
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('says a history deleted before its rename was removed, and puts nothing back', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, line(1));

    const result = await compactPromptHistoryFile(path, {
      sealer: createTestArtifactSealer(),
      pause: NO_PAUSE,
      beforeCommit: () => rmSync(path),
    });

    expect(result).toEqual({ status: 'removed' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('reports how much of the replaced file it could not catch up when the catch-up fails', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    writeFileSync(path, line(1));
    const writer = openSync(path, 'a');
    const late = new StoredLines({ sealer }, 'prompt-history-line').encode(
      line(2),
      PROMPT_HISTORY_OWNER_ID,
    );
    let pauses = 0;
    try {
      const result = await compactPromptHistoryFile(path, {
        sealer,
        pause: async () => {
          pauses += 1;
          if (pauses !== 1) return;
          // An append that opened the old file lands after the rename, and the keys lock before it is read.
          writeSync(writer, late);
          sealer.lock();
        },
      });

      expect(result).toMatchObject({
        status: 'compacted',
        entries: 1,
        catchUpFailed: { unreadBytes: Buffer.byteLength(late), reason: 'ArtifactLockedError' },
      });
    } finally {
      closeSync(writer);
    }
  });

  it('carries lines that do not open, or that a newer build sealed, over unchanged and counts them', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    const foreign = createTestArtifactSealer().sealLine(line(9), {
      kind: 'prompt-history-line',
      id: PROMPT_HISTORY_OWNER_ID,
    });
    const newer = 'RSL7:sealed-by-a-later-build';
    writeFileSync(path, `${line(1)}${foreign}\n\n${newer}\n${line(2)}`);

    const result = await compactPromptHistoryFile(path, { sealer, pause: NO_PAUSE });

    expect(result).toMatchObject({ status: 'compacted', entries: 2, carriedOver: 2 });
    const lines = physicalLines(path);
    expect(lines).toContain(foreign);
    expect(lines).toContain(newer);
    expect(lines).toHaveLength(4);
  });

  it('refuses a history that is a symbolic link, leaving the link and its target as they are', async () => {
    const root = directory();
    const target = join(root, 'synced-history.jsonl');
    writeFileSync(target, line(1));
    const path = join(root, 'history.jsonl');
    symlinkSync(target, path);

    const result = await compactPromptHistoryFile(path, {
      sealer: createTestArtifactSealer(),
      pause: NO_PAUSE,
    });

    expect(result).toEqual({ status: 'refused', reason: 'not-a-regular-file' });
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe(line(1));
  });

  it('refuses a history with another name, which a rename would leave holding the plaintext', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, line(1));
    linkSync(path, join(root, 'backup.jsonl'));

    const result = await compactPromptHistoryFile(path, {
      sealer: createTestArtifactSealer(),
      pause: NO_PAUSE,
    });

    expect(result).toEqual({ status: 'refused', reason: 'hard-linked' });
    expect(readFileSync(path, 'utf8')).toBe(line(1));
  });

  it('answers missing for a history that does not exist, and creates nothing', async () => {
    const root = directory();

    const result = await compactPromptHistoryFile(join(root, 'history.jsonl'), {
      sealer: createTestArtifactSealer(),
      pause: NO_PAUSE,
    });

    expect(result).toEqual({ status: 'missing' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('leaves the history and no temporary file behind when the commit is refused', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, line(1));

    await expect(
      compactPromptHistoryFile(path, {
        sealer: createTestArtifactSealer(),
        pause: NO_PAUSE,
        beforeCommit: () => {
          throw new Error('another process started');
        },
      }),
    ).rejects.toThrow('another process started');

    expect(readFileSync(path, 'utf8')).toBe(line(1));
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('stops without replacing anything when a sealed line cannot be opened because the keys are locked', async () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    const sealer = createTestArtifactSealer();
    new NodePromptHistoryFile(path, { sealing: { sealer } }).append(entry(1));
    const before = readFileSync(path, 'utf8');
    sealer.lock();

    await expect(compactPromptHistoryFile(path, { sealer, pause: NO_PAUSE })).rejects.toMatchObject(
      { code: 'ARTIFACT_LOCKED' },
    );

    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readdirSync(root)).toEqual(['history.jsonl']);
  });

  it('gives the same entries again when it runs a second time', async () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    mixedHistory(path, sealer);
    await compactPromptHistoryFile(path, { sealer, pause: NO_PAUSE });

    const again = await compactPromptHistoryFile(path, { sealer, pause: NO_PAUSE });

    expect(again).toMatchObject({ status: 'compacted', entries: 6, fromPlain: 0 });
    expect(await readTexts(path, sealer)).toEqual([1, 2, 3, 4, 5, 6].map((i) => entry(i).text));
  });
});

describe('inspectPromptHistoryFile', () => {
  it('counts plain lines, sealed lines that open, and lines that do not', () => {
    const path = join(directory(), 'history.jsonl');
    const sealer = createTestArtifactSealer();
    mixedHistory(path, sealer);
    appendFileSync(path, 'RSL7:sealed-by-a-later-build\n');

    expect(inspectPromptHistoryFile(path, { sealer })).toEqual({
      status: 'present',
      plainLines: 3,
      sealedLines: 2,
      unreadableLines: 1,
    });
  });

  it('refuses what compaction refuses, and answers missing for no file', () => {
    const root = directory();
    writeFileSync(join(root, 'target'), line(1));
    symlinkSync(join(root, 'target'), join(root, 'history.jsonl'));
    const sealer = createTestArtifactSealer();

    expect(inspectPromptHistoryFile(join(root, 'history.jsonl'), { sealer })).toEqual({
      status: 'refused',
      reason: 'not-a-regular-file',
    });
    expect(inspectPromptHistoryFile(join(root, 'absent.jsonl'), { sealer })).toEqual({
      status: 'missing',
    });
  });
});
