/**
 * A spill store given a sealing keeps every spilled tool result sealed on disk,
 * bound to its reference, and reads it back itself; one that says `'plain'` writes the result as it
 * is. A spilled result is conversation content, and the directory it sits in is open to every program
 * of the same user.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SEALED_ARTIFACT_MAX_OVERHEAD_BYTES } from '@robota-sdk/agent-core';
import { PROCESS_OWNER_RECORD_NAME } from '@robota-sdk/agent-core/node';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectKilled } from './__tests__/killed-child-helpers.js';
import {
  NodeToolResultSpillStore,
  sweepStaleToolResultSpillDirectories,
} from './tool-result-spill-store.js';

const MAX_SPILL_BYTES = 8 * 1024 * 1024;
const CANARY = 'CANARY-spill-0d4e-the-tool-said-this';
const parents: string[] = [];

function parent(): string {
  const path = mkdtempSync(join(tmpdir(), 'agent-spill-sealed-test-'));
  parents.push(path);
  return path;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of parents.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** The store's own directory under `root` and the results in it, without the owner record. */
function storeDirectory(root: string): { directory: string; results: string[] } {
  const [name] = readdirSync(root);
  const directory = join(root, name!);
  return {
    directory,
    results: readdirSync(directory).filter((entry) => entry !== PROCESS_OWNER_RECORD_NAME),
  };
}

function tokenOf(reference: string): string {
  return reference.slice('tool-result:'.length);
}

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('a sealing spill store', () => {
  it('writes <token>.sealed, never a .txt, sealed to its reference, and reads it back', async () => {
    const root = parent();
    const sealer = createTestArtifactSealer();
    const store = new NodeToolResultSpillStore({ parentDirectory: root, sealing: { sealer } });

    const { reference } = await store.write(CANARY);
    const { directory, results } = storeDirectory(root);
    expect(results).toEqual([`${tokenOf(reference)}.sealed`]);
    const stored = readFileSync(join(directory, results[0]!));
    expect(stored.subarray(0, 4).toString('latin1')).toBe('RSL1');
    expect(
      Buffer.from(
        sealer.openBytes(stored, { kind: 'tool-result-spill', id: tokenOf(reference) }),
      ).toString('utf8'),
    ).toBe(CANARY);
    if (process.platform !== 'win32') {
      expect(statSync(join(directory, results[0]!)).mode & 0o777).toBe(0o600);
    }
    expect(await store.read(reference)).toBe(CANARY);
    await store.shutdown();
    expect(readdirSync(root)).toEqual([]);
  });

  it('round-trips a result of exactly the largest size a spill takes', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      sealing: { sealer: createTestArtifactSealer() },
    });
    const content = 'x'.repeat(MAX_SPILL_BYTES);

    const { reference } = await store.write(content);
    const { directory, results } = storeDirectory(root);
    // The sealed file is larger than the plaintext budget, within the bound any sealer keeps to.
    const size = statSync(join(directory, results[0]!)).size;
    expect(size).toBeGreaterThan(MAX_SPILL_BYTES);
    expect(size).toBeLessThanOrEqual(MAX_SPILL_BYTES + SEALED_ARTIFACT_MAX_OVERHEAD_BYTES);
    expect(await store.read(reference)).toBe(content);
    await expect(store.write(`${content}y`)).rejects.toMatchObject({ code: 'write-failed' });
    await store.shutdown();
  });

  it('never leaves the result in plaintext under its parent or the temporary directory', async () => {
    const root = parent();
    const sharedTemporary = parent();
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, sharedTemporary);
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      sealing: { sealer: createTestArtifactSealer() },
    });

    const { reference } = await store.write(`${CANARY}\n${'context '.repeat(1000)}`);
    expect(await store.read(reference)).toContain(CANARY);
    const files = [root, sharedTemporary].flatMap(filesUnder);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file).includes(Buffer.from(CANARY)), file).toBe(false);
    }
    await store.shutdown();
  });

  it('opens a result once while it is paged, and again only after another result was read', async () => {
    const root = parent();
    const sealer = createTestArtifactSealer();
    const opens = vi.spyOn(sealer, 'openBytes');
    const store = new NodeToolResultSpillStore({ parentDirectory: root, sealing: { sealer } });
    const first = await store.write(`${CANARY}-first`);
    const second = await store.write(`${CANARY}-second`);

    for (let page = 0; page < 5; page += 1) {
      expect(await store.read(first.reference)).toBe(`${CANARY}-first`);
    }
    expect(opens).toHaveBeenCalledTimes(1);
    expect(await store.read(second.reference)).toBe(`${CANARY}-second`);
    expect(await store.read(first.reference)).toBe(`${CANARY}-first`);
    expect(opens).toHaveBeenCalledTimes(3);
    await store.shutdown();
  });

  it('answers read-failed for a result that does not open, or opens beyond the size a spill takes', async () => {
    const root = parent();
    const sealer = createTestArtifactSealer();
    const store = new NodeToolResultSpillStore({ parentDirectory: root, sealing: { sealer } });
    const { reference } = await store.write(CANARY);
    const { directory, results } = storeDirectory(root);
    const file = join(directory, results[0]!);
    const sealed = readFileSync(file);

    const flipped = Buffer.from(sealed);
    flipped[flipped.length - 1] ^= 0x01;
    writeFileSync(file, flipped);
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'read-failed' });

    writeFileSync(file, CANARY);
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'read-failed' });

    const context = { kind: 'tool-result-spill', id: tokenOf(reference) } as const;
    writeFileSync(file, sealer.sealBytes(Buffer.alloc(MAX_SPILL_BYTES + 1, 0x61), context));
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'read-failed' });

    writeFileSync(file, sealed);
    sealer.lock();
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'read-failed' });
    sealer.unlock();
    expect(await store.read(reference)).toBe(CANARY);
    await store.shutdown();
  });

  it('does not open a result moved to another reference', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      sealing: { sealer: createTestArtifactSealer() },
    });
    const first = await store.write(`${CANARY}-first`);
    const second = await store.write(`${CANARY}-second`);
    const { directory } = storeDirectory(root);
    writeFileSync(
      join(directory, `${tokenOf(second.reference)}.sealed`),
      readFileSync(join(directory, `${tokenOf(first.reference)}.sealed`)),
    );

    await expect(store.read(second.reference)).rejects.toMatchObject({ code: 'read-failed' });
    await store.shutdown();
  });

  it('expires a sealed result, even one it has open, and removes its file', async () => {
    const root = parent();
    let now = 1_000;
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      retentionMs: 10,
      now: () => now,
      sealing: { sealer: createTestArtifactSealer() },
    });
    const { reference } = await store.write(CANARY);
    expect(await store.read(reference)).toBe(CANARY);
    now = 1_010;

    await expect(store.read(reference)).rejects.toMatchObject({ code: 'expired' });
    expect(storeDirectory(root).results).toEqual([]);
    await store.shutdown();
  });

  it('forgets the result it has open before removing its file, even when the removal fails', async () => {
    const root = parent();
    let now = 1_000;
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      retentionMs: 10,
      now: () => now,
      sealing: { sealer: createTestArtifactSealer() },
    });
    const { reference } = await store.write(CANARY);
    expect(await store.read(reference)).toBe(CANARY);
    // A directory where the result was: removing the result's name fails, as no file removal can.
    const { directory, results } = storeDirectory(root);
    const file = join(directory, results[0]!);
    rmSync(file);
    mkdirSync(file);
    writeFileSync(join(file, 'kept'), 'x');
    now = 1_010;
    await expect(store.cleanupExpired()).rejects.toMatchObject({ code: 'cleanup-failed' });

    // Back inside its retention, the result is read from its file again, which is gone now: what
    // was open was not kept past the removal that failed.
    rmSync(file, { recursive: true });
    now = 1_005;
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'missing' });
    await store.shutdown();
  });

  it('counts an expired result whose file is already gone as removed, so the next write goes on', async () => {
    const root = parent();
    let now = 1_000;
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      retentionMs: 10,
      now: () => now,
      sealing: { sealer: createTestArtifactSealer() },
    });
    const first = await store.write(CANARY);
    expect(await store.read(first.reference)).toBe(CANARY);
    const { directory, results } = storeDirectory(root);
    rmSync(join(directory, results[0]!));
    now = 1_010;

    const second = await store.write(`${CANARY}-second`);

    expect(await store.read(second.reference)).toBe(`${CANARY}-second`);
    await expect(store.read(first.reference)).rejects.toMatchObject({ code: 'missing' });
    await store.shutdown();
  });

  it('forgets the result it has open at shutdown', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({
      parentDirectory: root,
      sealing: { sealer: createTestArtifactSealer() },
    });
    const { reference } = await store.write(CANARY);
    expect(await store.read(reference)).toBe(CANARY);

    await store.shutdown();
    await expect(store.read(reference)).rejects.toMatchObject({ code: 'closed' });
    expect(readdirSync(root)).toEqual([]);
  });

  it('leaves a directory a killed process left to the sweep, sealed files and all', () => {
    const root = parent();
    const module = (path: string): string =>
      JSON.stringify(pathToFileURL(fileURLToPath(new URL(path, import.meta.url))).href);
    const script = [
      `import { NodeToolResultSpillStore } from ${module('./tool-result-spill-store.ts')};`,
      `import { createTestArtifactSealer } from ${module('../../agent-core/src/testing/index.ts')};`,
      'const sealing = { sealer: createTestArtifactSealer() };',
      'const store = new NodeToolResultSpillStore({ parentDirectory: process.argv[1], sealing });',
      `await store.write(${JSON.stringify(CANARY)});`,
      "process.kill(process.pid, 'SIGKILL');",
    ].join('\n');
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

    const child = spawnSync(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, root],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expectKilled(child);
    const [left] = readdirSync(root);
    expect(storeDirectory(root).results).toEqual([expect.stringMatching(/\.sealed$/u)]);
    expect(sweepStaleToolResultSpillDirectories(root)).toEqual([left]);
    expect(readdirSync(root)).toEqual([]);
  });
});

describe('a spill store that says plain', () => {
  it('writes <token>.txt holding the result as it is', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ sealing: 'plain', parentDirectory: root });
    // Plaintext that starts like a sealed artifact is still only plaintext here.
    const content = `RSL1:${CANARY}`;

    const { reference } = await store.write(content);
    const { directory, results } = storeDirectory(root);
    expect(results).toEqual([`${tokenOf(reference)}.txt`]);
    expect(readFileSync(join(directory, results[0]!), 'utf8')).toBe(content);
    expect(await store.read(reference)).toBe(content);
    await store.shutdown();
  });

  it('reads the file again on every read', async () => {
    const root = parent();
    const store = new NodeToolResultSpillStore({ parentDirectory: root, sealing: 'plain' });
    const { reference } = await store.write(CANARY);
    const { directory, results } = storeDirectory(root);
    expect(await store.read(reference)).toBe(CANARY);
    writeFileSync(join(directory, results[0]!), `${CANARY}-changed`);
    expect(await store.read(reference)).toBe(`${CANARY}-changed`);
    await store.shutdown();
  });

  it('refuses a sealing that is not one', () => {
    expect(
      () =>
        new NodeToolResultSpillStore({
          parentDirectory: parent(),
          sealing: { sealer: {} } as never,
        }),
    ).toThrow(expect.objectContaining({ code: 'invalid-options' }));
  });
});
