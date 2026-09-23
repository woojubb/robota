import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodePromptHistoryFile, parsePromptHistoryLine } from '../prompt-history-file.js';

import type { IPromptHistoryBlock, IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';

const roots: string[] = [];
function temp(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-prompt-history-')));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function entry(index: number, project = '/p/one'): IPromptHistoryEntry {
  return {
    at: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    sessionId: `s${index % 3}`,
    project,
    text: `prompt ${index}`,
  };
}

async function collect(
  file: NodePromptHistoryFile,
  signal = new AbortController().signal,
): Promise<IPromptHistoryBlock[]> {
  const blocks: IPromptHistoryBlock[] = [];
  for await (const block of file.read({ signal })) blocks.push(block);
  return blocks;
}

describe('NodePromptHistoryFile (SCREEN-1993 TC-01)', () => {
  it('appends one JSON line per entry with owner-only directory and file modes', () => {
    const root = temp();
    const path = join(root, '.robota', 'history.jsonl');
    const file = new NodePromptHistoryFile(path, { ownedRoot: root });
    file.append(entry(1));
    file.append(entry(2));
    const lines = readFileSync(path, 'utf8').split('\n');
    expect(lines).toHaveLength(3); // two entries, trailing newline
    expect(JSON.parse(lines[0]!)).toEqual(entry(1));
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(join(root, '.robota')).mode & 0o777).toBe(0o700);
    }
  });

  it('reads newest-first across several blocks, carrying a line split by a block boundary', async () => {
    const root = temp();
    const path = join(root, 'history.jsonl');
    const writer = new NodePromptHistoryFile(path);
    const total = 120;
    for (let index = 0; index < total; index += 1) writer.append(entry(index));
    // A block far smaller than the file: many boundaries, most of them mid-line.
    const reader = new NodePromptHistoryFile(path, { blockBytes: 97 });
    const blocks = await collect(reader);
    expect(blocks.length).toBeGreaterThan(1);
    const texts = blocks.flatMap((block) => block.entries.map((item) => item.text));
    expect(texts).toHaveLength(total);
    expect(texts[0]).toBe(`prompt ${total - 1}`);
    expect(texts[total - 1]).toBe('prompt 0');
    expect(texts).toEqual([...texts].sort((a, b) => Number(b.slice(7)) - Number(a.slice(7))));
    expect(blocks.every((block) => block.skippedLines === 0)).toBe(true);
  });

  it('counts a malformed line as skipped and never yields it', async () => {
    const root = temp();
    const path = join(root, 'history.jsonl');
    const writer = new NodePromptHistoryFile(path);
    writer.append(entry(1));
    // Two bad lines: not JSON, and JSON of the wrong shape.
    const { appendFileSync } = await import('node:fs');
    appendFileSync(path, 'not json at all\n{"at":"x"}\n');
    writer.append(entry(2));
    const blocks = await collect(new NodePromptHistoryFile(path));
    expect(blocks.flatMap((block) => block.entries.map((item) => item.text))).toEqual([
      'prompt 2',
      'prompt 1',
    ]);
    expect(blocks.reduce((sum, block) => sum + block.skippedLines, 0)).toBe(2);
    expect(parsePromptHistoryLine('')).toBeUndefined();
  });

  it('stops between blocks once the signal is aborted', async () => {
    const root = temp();
    const path = join(root, 'history.jsonl');
    const writer = new NodePromptHistoryFile(path);
    for (let index = 0; index < 60; index += 1) writer.append(entry(index));
    const controller = new AbortController();
    const reader = new NodePromptHistoryFile(path, { blockBytes: 200 });
    const seen: IPromptHistoryBlock[] = [];
    for await (const block of reader.read({ signal: controller.signal })) {
      seen.push(block);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });

  it('yields nothing for a missing file and throws for a path that is a directory', async () => {
    const root = temp();
    expect(await collect(new NodePromptHistoryFile(join(root, 'absent.jsonl')))).toEqual([]);
    const directory = join(root, 'history.jsonl');
    mkdirSync(directory);
    await expect(collect(new NodePromptHistoryFile(directory))).rejects.toThrow();
  });
});
