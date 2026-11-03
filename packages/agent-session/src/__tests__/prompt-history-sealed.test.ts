/**
 * The prompt-history file with a sealer (#3679, secure conversation). A sealing file appends each
 * entry as one sealed line that opens on its own, so the backward block reader renders newest-first
 * without any line waiting for another, and says how many prompts it could not open — locked, or no
 * keys in this process — instead of letting them look absent. A plain file is byte for byte what
 * every earlier build wrote.
 */
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { NodePromptHistoryFile } from '../prompt-history-file.js';

import type { IPromptHistoryBlock, IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-8be1-a-prompt-the-person-typed';
const roots: string[] = [];

function historyPath(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-prompt-history-sealed-')));
  roots.push(root);
  return join(root, 'history.jsonl');
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function entry(index: number): IPromptHistoryEntry {
  return {
    at: `2026-11-01T00:${String(index).padStart(2, '0')}:00.000Z`,
    sessionId: `s${index % 2}`,
    project: '/work',
    text: `${CANARY} ${index}`,
  };
}

async function collect(file: NodePromptHistoryFile): Promise<IPromptHistoryBlock[]> {
  const blocks: IPromptHistoryBlock[] = [];
  for await (const block of file.read({ signal: new AbortController().signal })) blocks.push(block);
  return blocks;
}

function texts(blocks: readonly IPromptHistoryBlock[]): string[] {
  return blocks.flatMap((block) => block.entries.map((item) => item.text));
}

function totals(blocks: readonly IPromptHistoryBlock[]): {
  skippedLines: number;
  locked: number;
  noKeys: number;
} {
  return blocks.reduce(
    (sum, block) => ({
      skippedLines: sum.skippedLines + block.skippedLines,
      locked: sum.locked + (block.unreadable?.locked ?? 0),
      noKeys: sum.noKeys + (block.unreadable?.noKeys ?? 0),
    }),
    { skippedLines: 0, locked: 0, noKeys: 0 },
  );
}

describe('a plain prompt-history file', () => {
  it('writes exactly the bytes every earlier build wrote', () => {
    const path = historyPath();
    const file = new NodePromptHistoryFile(path, { sealing: 'plain' });
    file.append(entry(1));
    new NodePromptHistoryFile(path).append(entry(2));
    expect(readFileSync(path, 'utf8')).toBe(
      `${JSON.stringify(entry(1))}\n${JSON.stringify(entry(2))}\n`,
    );
  });

  it('reads blocks without an unreadable count when every line is plain', async () => {
    const path = historyPath();
    const file = new NodePromptHistoryFile(path);
    file.append(entry(1));
    expect(await collect(file)).toEqual([{ entries: [entry(1)], skippedLines: 0 }]);
  });
});

describe('a sealing prompt-history file', () => {
  it('appends each entry as one sealed line with a newline on both sides, and nothing in the clear', () => {
    const path = historyPath();
    const file = new NodePromptHistoryFile(path, {
      sealing: { sealer: createTestArtifactSealer() },
    });
    file.append(entry(1));
    file.append(entry(2));
    const bytes = readFileSync(path, 'utf8');
    expect(bytes).toMatch(/^\nRSL1:[A-Za-z0-9_-]+\n\nRSL1:[A-Za-z0-9_-]+\n$/);
    expect(bytes).not.toContain(CANARY);
  });

  it('reads every entry back newest first, the first block before the rest', async () => {
    const path = historyPath();
    const sealer = createTestArtifactSealer();
    const file = new NodePromptHistoryFile(path, { sealing: { sealer } });
    for (let index = 0; index < 30; index += 1) file.append(entry(index));

    const reader = new NodePromptHistoryFile(path, { sealing: { sealer }, blockBytes: 300 });
    const blocks = await collect(reader);
    expect(blocks.length).toBeGreaterThan(2);
    expect(blocks[0]?.entries.length).toBeGreaterThan(0);
    expect(texts(blocks)).toEqual(
      Array.from({ length: 30 }, (_, index) => `${CANARY} ${29 - index}`),
    );
    expect(totals(blocks)).toEqual({ skippedLines: 0, locked: 0, noKeys: 0 });
    expect(blocks.every((block) => block.unreadable === undefined)).toBe(true);
  });

  it('counts sealed prompts it cannot open as locked, or as no keys in a plain process', async () => {
    const path = historyPath();
    const sealer = createTestArtifactSealer();
    const file = new NodePromptHistoryFile(path, { sealing: { sealer } });
    appendFileSync(path, `${JSON.stringify(entry(0))}\n`);
    file.append(entry(1));
    file.append(entry(2));

    sealer.lock();
    const locked = await collect(file);
    expect(texts(locked)).toEqual([`${CANARY} 0`]);
    expect(totals(locked)).toEqual({ skippedLines: 0, locked: 2, noKeys: 0 });
    expect(locked[0]?.unreadable).toEqual({ locked: 2, noKeys: 0 });

    const plain = await collect(new NodePromptHistoryFile(path));
    expect(texts(plain)).toEqual([`${CANARY} 0`]);
    expect(totals(plain)).toEqual({ skippedLines: 0, locked: 0, noKeys: 2 });

    const writeOnly = await collect(
      new NodePromptHistoryFile(path, {
        sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
      }),
    );
    expect(totals(writeOnly)).toEqual({ skippedLines: 0, locked: 0, noKeys: 2 });
  });

  it('keeps a record written after a torn append, ignores an unfinished tail, and skips damage and newer lines', async () => {
    const path = historyPath();
    const sealer = createTestArtifactSealer();
    const file = new NodePromptHistoryFile(path, { sealing: { sealer } });
    file.append(entry(1));
    // A writer that died part-way through its append: the next append's leading newline keeps the
    // fragment on a line of its own.
    const torn = readFileSync(path, 'utf8').trim().slice(0, 30);
    appendFileSync(path, `\n${torn}`);
    file.append(entry(2));
    appendFileSync(path, 'RSL2:written-by-a-newer-build\n');
    file.append(entry(3));
    // Another writer is part-way through its append right now.
    appendFileSync(path, `\n${torn}`);

    const blocks = await collect(
      new NodePromptHistoryFile(path, { sealing: { sealer }, blockBytes: 64 }),
    );
    expect(texts(blocks)).toEqual([`${CANARY} 3`, `${CANARY} 2`, `${CANARY} 1`]);
    expect(totals(blocks)).toEqual({ skippedLines: 2, locked: 0, noKeys: 0 });
  });

  it('reads back every entry of two writers appending in turn, in file order', async () => {
    const path = historyPath();
    // Two processes: two sealers over one keyring, each with writer state of its own.
    const key = Buffer.alloc(32, 7);
    const first = new NodePromptHistoryFile(path, {
      sealing: { sealer: createTestArtifactSealer({ key, locked: true }) },
    });
    const second = new NodePromptHistoryFile(path, {
      sealing: { sealer: createTestArtifactSealer({ key, locked: true }) },
    });
    for (let index = 0; index < 10; index += 1) {
      (index % 2 === 0 ? first : second).append(entry(index));
    }

    const reader = createTestArtifactSealer({ key });
    const blocks = await collect(new NodePromptHistoryFile(path, { sealing: { sealer: reader } }));
    expect(texts(blocks)).toEqual(
      Array.from({ length: 10 }, (_, index) => `${CANARY} ${9 - index}`),
    );
  });

  it('writes nothing when sealing fails', () => {
    const path = historyPath();
    const sealer = {
      ...createTestArtifactSealer(),
      sealLine: () => {
        throw new Error('no sealing key');
      },
    };
    const file = new NodePromptHistoryFile(path, { sealing: { sealer } });
    expect(() => file.append(entry(1))).toThrow('no sealing key');
    expect(() => readFileSync(path)).toThrow(/ENOENT/);
  });
});
