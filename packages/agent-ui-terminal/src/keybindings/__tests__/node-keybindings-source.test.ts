import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_KEYBINDINGS_DOCUMENT,
  createNodeKeybindingsSource,
} from '../node-keybindings-source.js';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'robota-keybindings-'));
  roots.push(root);
  return root;
}

async function eventually(assertion: () => void, timeout = 2_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assertion();
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Node keybindings source', () => {
  it('atomically creates the schema-linked sparse document and never overwrites it', async () => {
    const root = await temporaryRoot();
    const source = createNodeKeybindingsSource({ homeDir: root });
    const firstPath = await source.ensureFile();
    expect(firstPath).toBe(join(root, '.robota', 'keybindings.json'));
    expect(JSON.parse(await readFile(firstPath, 'utf8'))).toEqual(DEFAULT_KEYBINDINGS_DOCUMENT);

    await writeFile(firstPath, '{"owned":true}\n', 'utf8');
    expect(await source.ensureFile()).toBe(firstPath);
    expect(await readFile(firstPath, 'utf8')).toBe('{"owned":true}\n');
    source.dispose();
  });

  it('loads atomic replacements, retains last-valid bindings on invalid input, and disposes', async () => {
    const root = await temporaryRoot();
    const log = vi.fn();
    const source = createNodeKeybindingsSource({ homeDir: root, onDiagnostic: log });
    await source.start();
    const path = await source.ensureFile();
    const snapshots = [source.getSnapshot()];
    const unsubscribe = source.subscribe((snapshot) => snapshots.push(snapshot));

    const replacement = join(root, '.robota', 'keybindings.next.json');
    await writeFile(
      replacement,
      JSON.stringify({ version: 1, bindings: { 'chat-input': { submit: 'ctrl+k' } } }),
      'utf8',
    );
    await rename(replacement, path);
    await eventually(() => {
      expect(source.getSnapshot().bindings['chat-input'].submit).toEqual(['ctrl+k']);
    });
    const valid = source.getSnapshot();

    await writeFile(replacement, '{"version":1,"bindings":{"missing":{}}}', 'utf8');
    await rename(replacement, path);
    await eventually(() => {
      expect(source.getSnapshot().diagnostic?.path).toBe('$.bindings.missing');
    });
    expect(source.getSnapshot().bindings).toBe(valid.bindings);
    expect(source.getSnapshot().generation).toBeGreaterThan(valid.generation);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ file: path }));

    unsubscribe();
    source.dispose();
    const count = snapshots.length;
    await writeFile(path, JSON.stringify(DEFAULT_KEYBINDINGS_DOCUMENT), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(snapshots).toHaveLength(count);
  });

  it('shares one start, and a failed start leaves no half-started source', async () => {
    const root = await temporaryRoot();
    const source = createNodeKeybindingsSource({ homeDir: root });
    await Promise.all([source.start(), source.start()]);
    expect(source.isStarted()).toBe(true);
    source.dispose();
    expect(source.isStarted()).toBe(false);
    await expect(source.start()).rejects.toThrow(/disposed/i);
  });
});
