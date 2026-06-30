import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFsAssetStore } from '../adapters/local-fs-asset-store.js';

let tmpDir: string;
let store: LocalFsAssetStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dag-asset-store-test-'));
  store = new LocalFsAssetStore(tmpDir);
  await store.initialize();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('LocalFsAssetStore.initialize', () => {
  it('creates the root directory if it does not exist', async () => {
    const newDir = path.join(tmpDir, 'new-subdir');
    const freshStore = new LocalFsAssetStore(newDir);
    await freshStore.initialize();
    const { existsSync } = await import('node:fs');
    expect(existsSync(newDir)).toBe(true);
  });

  it('does not throw when directory already exists', async () => {
    await expect(store.initialize()).resolves.not.toThrow();
  });
});

describe('LocalFsAssetStore.save', () => {
  it('saves binary content and returns metadata with assetId', async () => {
    const content = Buffer.from('hello binary content');
    const metadata = await store.save({
      fileName: 'test.bin',
      mediaType: 'application/octet-stream',
      content,
    });

    expect(typeof metadata.assetId).toBe('string');
    expect(metadata.assetId.length).toBeGreaterThan(0);
    expect(metadata.fileName).toBe('test.bin');
    expect(metadata.mediaType).toBe('application/octet-stream');
    expect(metadata.sizeBytes).toBe(content.byteLength);
    expect(typeof metadata.createdAt).toBe('string');
  });

  it('writes a .bin file and .json metadata sidecar to disk', async () => {
    const content = Buffer.from('data');
    const metadata = await store.save({
      fileName: 'data.bin',
      mediaType: 'application/octet-stream',
      content,
    });

    const binPath = path.join(tmpDir, `${metadata.assetId}.bin`);
    const jsonPath = path.join(tmpDir, `${metadata.assetId}.json`);

    const savedBin = await readFile(binPath);
    expect(savedBin.equals(content)).toBe(true);

    const savedMeta = JSON.parse(await readFile(jsonPath, 'utf-8')) as { assetId: string };
    expect(savedMeta.assetId).toBe(metadata.assetId);
  });

  it('includes runtimeAssetId when provided', async () => {
    const metadata = await store.save({
      fileName: 'img.png',
      mediaType: 'image/png',
      content: Buffer.from([1, 2, 3]),
      runtimeAssetId: 'runtime-xyz',
    });
    expect(metadata.runtimeAssetId).toBe('runtime-xyz');
  });
});

describe('LocalFsAssetStore.saveReference', () => {
  it('saves only metadata (no binary file) and returns metadata', async () => {
    const metadata = await store.saveReference({
      fileName: 'remote.jpg',
      mediaType: 'image/jpeg',
      sourceUri: 'https://example.com/image.jpg',
      binaryKind: 'image',
      sizeBytes: 1024,
    });

    expect(typeof metadata.assetId).toBe('string');
    expect(metadata.sourceUri).toBe('https://example.com/image.jpg');
    expect(metadata.sizeBytes).toBe(1024);
    expect(metadata.binaryKind).toBe('image');

    const binPath = path.join(tmpDir, `${metadata.assetId}.bin`);
    const { existsSync } = await import('node:fs');
    expect(existsSync(binPath)).toBe(false);
  });

  it('uses 0 as sizeBytes when not provided', async () => {
    const metadata = await store.saveReference({
      fileName: 'audio.mp3',
      mediaType: 'audio/mpeg',
      sourceUri: 'https://example.com/audio.mp3',
      binaryKind: 'audio',
    });
    expect(metadata.sizeBytes).toBe(0);
  });
});

describe('LocalFsAssetStore.getMetadata', () => {
  it('returns undefined for unknown assetId', async () => {
    const result = await store.getMetadata('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('returns metadata for a saved asset', async () => {
    const saved = await store.save({
      fileName: 'file.txt',
      mediaType: 'text/plain',
      content: Buffer.from('content'),
    });

    const retrieved = await store.getMetadata(saved.assetId);
    expect(retrieved).not.toBeUndefined();
    expect(retrieved?.assetId).toBe(saved.assetId);
    expect(retrieved?.fileName).toBe('file.txt');
  });
});

describe('LocalFsAssetStore.getContent', () => {
  it('returns undefined for unknown assetId', async () => {
    const result = await store.getContent('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('returns a readable stream for a saved binary asset', async () => {
    const content = Buffer.from('stream me');
    const saved = await store.save({
      fileName: 'streamable.bin',
      mediaType: 'application/octet-stream',
      content,
    });

    const result = await store.getContent(saved.assetId);
    expect(result).not.toBeUndefined();
    expect(result?.metadata.assetId).toBe(saved.assetId);

    const chunks: Uint8Array[] = [];
    for await (const chunk of result!.stream) {
      chunks.push(chunk);
    }
    const combined = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    expect(combined.equals(content)).toBe(true);
  });
});
