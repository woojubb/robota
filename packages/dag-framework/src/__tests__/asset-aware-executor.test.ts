import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IAssetStore,
  IPortBinaryValue,
  ITaskExecutionInput,
  ITaskExecutorPort,
  TPortPayload,
  TTaskExecutionResult,
} from '@robota-sdk/dag-core';
import { AssetAwareTaskExecutorPort } from '../adapters/asset-aware-executor.js';
import { LocalFsAssetStore } from '../adapters/local-fs-asset-store.js';

function makeDelegate(output: TPortPayload): ITaskExecutorPort {
  return {
    execute: vi.fn().mockResolvedValue({ ok: true, output, estimatedCredits: 0, totalCredits: 0 }),
  } as unknown as ITaskExecutorPort;
}

function makeFailDelegate(error: unknown): ITaskExecutorPort {
  return {
    execute: vi.fn().mockResolvedValue({ ok: false, error }),
  } as unknown as ITaskExecutorPort;
}

const FAKE_TASK_INPUT = {
  nodeDefinition: {
    nodeId: 'n1',
    nodeType: 'transform',
    dependsOn: [],
    config: {},
    inputs: [],
    outputs: [],
  },
  input: {},
} as unknown as ITaskExecutionInput;

let tmpDir: string;
let assetStore: IAssetStore;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dag-asset-executor-test-'));
  const fsStore = new LocalFsAssetStore(tmpDir);
  await fsStore.initialize();
  assetStore = fsStore;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('AssetAwareTaskExecutorPort', () => {
  it('passes through string port values unchanged', async () => {
    const output: TPortPayload = { text: 'hello' };
    const executor = new AssetAwareTaskExecutorPort(makeDelegate(output), assetStore);
    const result = await executor.execute(FAKE_TASK_INPUT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output['text']).toBe('hello');
  });

  it('propagates delegate failure result unchanged', async () => {
    const delegate = makeFailDelegate({ code: 'DAG_EXEC_ERROR', message: 'kaboom' });
    const executor = new AssetAwareTaskExecutorPort(delegate, assetStore);
    const result = await executor.execute(FAKE_TASK_INPUT);
    expect(result.ok).toBe(false);
  });

  it('saves a new asset reference for a binary port without existing asset:// URI', async () => {
    const binaryValue: IPortBinaryValue = {
      kind: 'image',
      mimeType: 'image/png',
      uri: 'https://example.com/photo.png',
    };
    const output: TPortPayload = { image: binaryValue };
    const executor = new AssetAwareTaskExecutorPort(makeDelegate(output), assetStore);
    const result = (await executor.execute(FAKE_TASK_INPUT)) as Extract<
      TTaskExecutionResult,
      { ok: true }
    >;
    expect(result.ok).toBe(true);
    const mapped = result.output['image'] as IPortBinaryValue & {
      referenceType: string;
      assetId: string;
    };
    expect(mapped.referenceType).toBe('asset');
    expect(mapped.uri).toMatch(/^asset:\/\//);
    expect(typeof mapped.assetId).toBe('string');
  });

  it('reuses existing assetId when URI is already asset://', async () => {
    const existingAssetId = 'existing-uuid-1234';
    const binaryValue: IPortBinaryValue = {
      kind: 'video',
      mimeType: 'video/mp4',
      uri: `asset://${existingAssetId}`,
    };
    const output: TPortPayload = { video: binaryValue };
    const executor = new AssetAwareTaskExecutorPort(makeDelegate(output), assetStore);
    const result = (await executor.execute(FAKE_TASK_INPUT)) as Extract<
      TTaskExecutionResult,
      { ok: true }
    >;
    expect(result.ok).toBe(true);
    const mapped = result.output['video'] as IPortBinaryValue & { assetId: string };
    expect(mapped.assetId).toBe(existingAssetId);
    expect(mapped.uri).toBe(`asset://${existingAssetId}`);
  });

  it('preserves non-binary entries alongside binary ones', async () => {
    const binaryValue: IPortBinaryValue = {
      kind: 'audio',
      mimeType: 'audio/mpeg',
      uri: 'https://example.com/clip.mp3',
    };
    const output: TPortPayload = { text: 'kept', audio: binaryValue };
    const executor = new AssetAwareTaskExecutorPort(makeDelegate(output), assetStore);
    const result = (await executor.execute(FAKE_TASK_INPUT)) as Extract<
      TTaskExecutionResult,
      { ok: true }
    >;
    expect(result.ok).toBe(true);
    expect(result.output['text']).toBe('kept');
    const mapped = result.output['audio'] as IPortBinaryValue & { referenceType: string };
    expect(mapped.referenceType).toBe('asset');
  });
});
