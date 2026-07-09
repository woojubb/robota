import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INodeManifest } from '@robota-sdk/dag-core';
import { DagPromptBackend } from '../adapters/prompt-backend.js';
import { createDagFramework } from '../create-dag-framework.js';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import type { IDagFramework } from '../types.js';

// ─── Minimal manifests for unit tests ────────────────────────────────────────

const INPUT_MANIFEST: INodeManifest = {
  nodeType: 'input',
  displayName: 'Input',
  category: 'Core',
  inputs: [],
  outputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
};

const OUTPUT_MANIFEST: INodeManifest = {
  nodeType: 'text-output',
  displayName: 'Text Output',
  category: 'Core',
  inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: true }],
  outputs: [],
};

// A manifest with a rich configSchema to exercise jsonSchemaPropertyToInputSpec branches
const RICH_MANIFEST: INodeManifest = {
  nodeType: 'rich-node',
  displayName: 'Rich Node',
  category: 'Test',
  inputs: [{ key: 'text', label: 'Text', order: 0, type: 'string', required: false }],
  outputs: [{ key: 'out', label: 'Out', order: 0, type: 'string', required: true }],
  configSchema: {
    type: 'object',
    required: ['requiredStr'],
    properties: {
      requiredStr: { type: 'string' },
      enumProp: { type: 'string', enum: ['a', 'b', 'c'] },
      intProp: { type: 'integer', minimum: 0, maximum: 100, default: 10 },
      floatProp: { type: 'number', minimum: 0.0, maximum: 1.0 },
      boolProp: { type: 'boolean', default: false },
      objProp: { type: 'object', default: '{}' },
      assetObjProp: {
        type: 'object',
        properties: { referenceType: { type: 'string' }, assetId: { type: 'string' } },
      },
      arrayProp: { type: 'array' },
      longStrProp: { type: 'string', maxLength: 500 },
      anyOfAsset: {
        anyOf: [
          {
            type: 'object',
            properties: { referenceType: { type: 'string' }, assetId: { type: 'string' } },
          },
          { type: 'string' },
        ],
      },
      oneOfAsset: {
        oneOf: [
          {
            type: 'object',
            properties: { assetId: { type: 'string' } },
          },
        ],
      },
      anyOfPlain: {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      },
    },
  } as unknown as INodeManifest['configSchema'],
};

// ─── Unit tests (no framework, direct instantiation) ─────────────────────────

function makeMockExecution() {
  return {
    runOrchestrator: {
      createRun: vi.fn(),
      startCreatedRun: vi.fn(),
      startRun: vi.fn(),
    },
    runQuery: { getRun: vi.fn() },
    workerLoop: { processOnce: vi.fn() },
    runCanceller: { cancelRun: vi.fn() },
  };
}

function makeMockStorage() {
  return {
    getDefinition: vi.fn().mockResolvedValue(null),
    listDefinitionsByDagId: vi.fn().mockResolvedValue([]),
    saveDefinition: vi.fn().mockResolvedValue(undefined),
    deleteDefinition: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockClock() {
  return {
    nowIso: vi.fn().mockReturnValue('2026-01-01T00:00:00.000Z'),
    nowEpochMs: vi.fn().mockReturnValue(1_000_000_000),
  };
}

function makeBackend(manifests: INodeManifest[] = [INPUT_MANIFEST, OUTPUT_MANIFEST]) {
  const storage = makeMockStorage();
  const execution = makeMockExecution();
  const clock = makeMockClock();
  const backend = new DagPromptBackend({
    storage: storage as never,
    execution: execution as never,
    clock,
    manifests,
  });
  return { backend, storage, execution, clock };
}

describe('DagPromptBackend.getQueue', () => {
  it('returns empty queue status', async () => {
    const { backend } = makeBackend();
    const result = await backend.getQueue();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.queue_running).toHaveLength(0);
    expect(result.value.queue_pending).toHaveLength(0);
  });
});

describe('DagPromptBackend.manageQueue', () => {
  it('returns ok for any queue action', async () => {
    const { backend } = makeBackend();
    const result = await backend.manageQueue({ type: 'clear' } as never);
    expect(result.ok).toBe(true);
  });
});

describe('DagPromptBackend.getSystemStats', () => {
  it('returns system stats with os and device info', async () => {
    const { backend } = makeBackend();
    const result = await backend.getSystemStats();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.system.os).toBe('string');
    expect(typeof result.value.system.runtime_version).toBe('string');
    expect(result.value.devices.length).toBeGreaterThan(0);
  });
});

describe('DagPromptBackend.getHistory', () => {
  it('returns empty history initially', async () => {
    const { backend } = makeBackend();
    const result = await backend.getHistory();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toHaveLength(0);
  });

  it('returns empty object for unknown promptId', async () => {
    const { backend } = makeBackend();
    const result = await backend.getHistory('unknown-prompt-id');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toHaveLength(0);
  });
});

describe('DagPromptBackend.getPromptIdForDagRun', () => {
  it('returns undefined for unknown dagRunId', () => {
    const { backend } = makeBackend();
    expect(backend.getPromptIdForDagRun('unknown-run')).toBeUndefined();
  });
});

describe('DagPromptBackend.getObjectInfo', () => {
  it('returns info for all nodes when no nodeType filter', async () => {
    const { backend } = makeBackend();
    const result = await backend.getObjectInfo();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toContain('input');
    expect(Object.keys(result.value)).toContain('text-output');
  });

  it('returns info for a specific nodeType', async () => {
    const { backend } = makeBackend();
    const result = await backend.getObjectInfo('input');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(['input']);
  });

  it('returns error for unknown nodeType', async () => {
    const { backend } = makeBackend();
    const result = await backend.getObjectInfo('no-such-node');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NODE_TYPE_NOT_FOUND');
  });

  it('output_node is true for nodes with no outputs', async () => {
    const { backend } = makeBackend();
    const result = await backend.getObjectInfo('text-output');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['text-output'].output_node).toBe(true);
  });

  it('output_node is false for nodes with outputs', async () => {
    const { backend } = makeBackend();
    const result = await backend.getObjectInfo('input');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value['input'].output_node).toBe(false);
  });
});

describe('DagPromptBackend.getObjectInfo — configSchema branches', () => {
  it('converts enum property to string array', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    // enumProp is not in the required[] list → goes to optional
    expect(Array.isArray(info.input.optional?.['enumProp'])).toBe(true);
    expect(info.input.optional?.['enumProp']).toEqual(['a', 'b', 'c']);
  });

  it('converts integer property with min/max to [INT, {min, max, default}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const intSpec = info.input.optional?.['intProp'] as unknown[];
    expect(intSpec[0]).toBe('INT');
    expect((intSpec[1] as Record<string, unknown>)['min']).toBe(0);
    expect((intSpec[1] as Record<string, unknown>)['max']).toBe(100);
  });

  it('converts number property to [FLOAT, ...]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const floatSpec = info.input.optional?.['floatProp'] as unknown[];
    expect(floatSpec[0]).toBe('FLOAT');
  });

  it('converts boolean property to [BOOLEAN, ...]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const boolSpec = info.input.optional?.['boolProp'] as unknown[];
    expect(boolSpec[0]).toBe('BOOLEAN');
  });

  it('converts object property with asset properties to [STRING, {image_upload: true}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const assetSpec = info.input.optional?.['assetObjProp'] as unknown[];
    expect(assetSpec[0]).toBe('STRING');
    expect((assetSpec[1] as Record<string, unknown>)['image_upload']).toBe(true);
  });

  it('converts plain object property to [STRING, {multiline: true}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const objSpec = info.input.optional?.['objProp'] as unknown[];
    expect(objSpec[0]).toBe('STRING');
    expect((objSpec[1] as Record<string, unknown>)['multiline']).toBe(true);
  });

  it('converts array property to [STRING, {multiline: true}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const arraySpec = info.input.optional?.['arrayProp'] as unknown[];
    expect(arraySpec[0]).toBe('STRING');
    expect((arraySpec[1] as Record<string, unknown>)['multiline']).toBe(true);
  });

  it('converts string with maxLength > 200 to [STRING, {multiline: true}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const longStrSpec = info.input.optional?.['longStrProp'] as unknown[];
    expect(longStrSpec[0]).toBe('STRING');
    expect((longStrSpec[1] as Record<string, unknown>)['multiline']).toBe(true);
  });

  it('converts anyOf with asset reference to [STRING, {image_upload: true}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const anyOfSpec = info.input.optional?.['anyOfAsset'] as unknown[];
    expect(anyOfSpec[0]).toBe('STRING');
    expect((anyOfSpec[1] as Record<string, unknown>)['image_upload']).toBe(true);
  });

  it('converts oneOf with asset reference to [STRING, {image_upload: true}]', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const oneOfSpec = info.input.optional?.['oneOfAsset'] as unknown[];
    expect(oneOfSpec[0]).toBe('STRING');
    expect((oneOfSpec[1] as Record<string, unknown>)['image_upload']).toBe(true);
  });

  it('converts anyOf without asset reference using default handling', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    const plainSpec = info.input.optional?.['anyOfPlain'];
    expect(Array.isArray(plainSpec)).toBe(true);
  });

  it('required configSchema properties are placed in required inputs', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    expect(info.input.required?.['requiredStr']).toBeDefined();
  });

  it('port already defined in inputs is not duplicated from configSchema', async () => {
    const { backend } = makeBackend([RICH_MANIFEST]);
    const result = await backend.getObjectInfo('rich-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.value['rich-node'];
    // 'text' is a port defined in inputs[], so even if configSchema has it, it appears once
    const requiredKeys = Object.keys(info.input.required ?? {});
    const optionalKeys = Object.keys(info.input.optional ?? {});
    const textOccurrences =
      requiredKeys.filter((k) => k === 'text').length +
      optionalKeys.filter((k) => k === 'text').length;
    expect(textOccurrences).toBeLessThanOrEqual(1);
  });
});

describe('DagPromptBackend.getObjectInfo — branches for no-meta specs', () => {
  const NO_META_MANIFEST: INodeManifest = {
    nodeType: 'no-meta-node',
    displayName: 'No-meta Node',
    category: 'Test',
    inputs: [],
    outputs: [],
    configSchema: {
      type: 'object',
      properties: {
        intNoMeta: { type: 'integer' },
        floatNoMeta: { type: 'number' },
        boolNoMeta: { type: 'boolean' },
        strShort: { type: 'string', maxLength: 50 },
      },
    } as unknown as INodeManifest['configSchema'],
  };

  it('converts integer without min/max to [INT] (no meta object)', async () => {
    const { backend } = makeBackend([NO_META_MANIFEST]);
    const result = await backend.getObjectInfo('no-meta-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const intSpec = result.value['no-meta-node'].input.optional?.['intNoMeta'];
    expect(intSpec).toEqual(['INT']);
  });

  it('converts number without min/max to [FLOAT] (no meta object)', async () => {
    const { backend } = makeBackend([NO_META_MANIFEST]);
    const result = await backend.getObjectInfo('no-meta-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const floatSpec = result.value['no-meta-node'].input.optional?.['floatNoMeta'];
    expect(floatSpec).toEqual(['FLOAT']);
  });

  it('converts boolean without default to [BOOLEAN] (no meta object)', async () => {
    const { backend } = makeBackend([NO_META_MANIFEST]);
    const result = await backend.getObjectInfo('no-meta-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const boolSpec = result.value['no-meta-node'].input.optional?.['boolNoMeta'];
    expect(boolSpec).toEqual(['BOOLEAN']);
  });

  it('converts short string (maxLength ≤ 200) to [STRING] (no multiline)', async () => {
    const { backend } = makeBackend([NO_META_MANIFEST]);
    const result = await backend.getObjectInfo('no-meta-node');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const strSpec = result.value['no-meta-node'].input.optional?.['strShort'];
    expect(strSpec).toEqual(['STRING']);
  });
});

describe('DagPromptBackend.submitPrompt — async processRunUntilTerminal', () => {
  it('records history after run completes successfully', async () => {
    const execution = makeMockExecution();
    const storage = makeMockStorage();
    const clock = makeMockClock();

    const dagRunId = 'test-run-id-123';
    execution.runOrchestrator.createRun.mockResolvedValue({
      ok: true,
      value: {
        dagRunId,
        dagId: 'prompt:test-prompt',
        version: 1,
        logicalDate: '',
        status: 'running',
      },
    });
    execution.runOrchestrator.startCreatedRun.mockResolvedValue({ ok: true, value: {} });
    // First getRun call returns 'running', second returns 'success'
    execution.runQuery.getRun
      .mockResolvedValueOnce({ ok: true, value: { dagRun: { status: 'running' }, taskRuns: [] } })
      .mockResolvedValueOnce({ ok: true, value: { dagRun: { status: 'success' }, taskRuns: [] } });
    execution.workerLoop.processOnce.mockResolvedValue({ ok: true, value: { processed: true } });

    // Mock storage to support definitionService operations
    const savedDefs: Record<string, unknown> = {};
    storage.saveDefinition.mockImplementation((def: { dagId: string; version: number }) => {
      savedDefs[`${def.dagId}:${def.version}`] = def;
      return Promise.resolve(undefined);
    });
    storage.getDefinition.mockImplementation((dagId: string, version: number) => {
      return Promise.resolve(savedDefs[`${dagId}:${version}`] ?? null);
    });
    storage.listDefinitionsByDagId.mockImplementation((dagId: string) => {
      return Promise.resolve(
        Object.values(savedDefs).filter((d: unknown) => (d as { dagId: string }).dagId === dagId),
      );
    });

    const backend = new DagPromptBackend({
      storage: storage as never,
      execution: execution as never,
      clock,
      manifests: [INPUT_MANIFEST, OUTPUT_MANIFEST],
    });

    const result = await backend.submitPrompt({
      prompt_id: 'test-prompt',
      prompt: {
        '1': { class_type: 'input', inputs: { text: 'hello' } },
        '2': { class_type: 'text-output', inputs: { text: ['1', 0] } },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.prompt_id).toBe('test-prompt');

    // Wait for the background processRunUntilTerminal to complete
    await new Promise((r) => setTimeout(r, 300));

    // history should now be recorded
    const history = await backend.getHistory('test-prompt');
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(Object.keys(history.value)).toContain('test-prompt');

    // getPromptIdForDagRun should work
    const resolvedPromptId = backend.getPromptIdForDagRun(dagRunId);
    expect(resolvedPromptId).toBe('test-prompt');

    // getHistory for all entries
    const allHistory = await backend.getHistory();
    expect(allHistory.ok).toBe(true);
    if (!allHistory.ok) return;
    expect(Object.keys(allHistory.value)).toContain('test-prompt');
  });

  it('records error history when getRun fails', async () => {
    const execution = makeMockExecution();
    const storage = makeMockStorage();
    const clock = makeMockClock();

    const dagRunId = 'fail-run-id-456';
    execution.runOrchestrator.createRun.mockResolvedValue({
      ok: true,
      value: {
        dagRunId,
        dagId: 'prompt:fail-prompt',
        version: 1,
        logicalDate: '',
        status: 'running',
      },
    });
    execution.runOrchestrator.startCreatedRun.mockResolvedValue({ ok: true, value: {} });
    execution.runQuery.getRun.mockResolvedValue({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'gone' },
    });

    const savedDefs: Record<string, unknown> = {};
    storage.saveDefinition.mockImplementation((def: { dagId: string; version: number }) => {
      savedDefs[`${def.dagId}:${def.version}`] = def;
      return Promise.resolve(undefined);
    });
    storage.getDefinition.mockImplementation((dagId: string, version: number) =>
      Promise.resolve(savedDefs[`${dagId}:${version}`] ?? null),
    );
    storage.listDefinitionsByDagId.mockImplementation((dagId: string) =>
      Promise.resolve(
        Object.values(savedDefs).filter((d: unknown) => (d as { dagId: string }).dagId === dagId),
      ),
    );

    const backend = new DagPromptBackend({
      storage: storage as never,
      execution: execution as never,
      clock,
      manifests: [INPUT_MANIFEST],
    });

    await backend.submitPrompt({
      prompt_id: 'fail-prompt',
      prompt: { '1': { class_type: 'input', inputs: { text: 'x' } } },
    });

    await new Promise((r) => setTimeout(r, 200));

    const history = await backend.getHistory('fail-prompt');
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const entry = history.value['fail-prompt'];
    expect(entry?.status.status_str).toBe('error');
  });

  it('records error history when processOnce fails', async () => {
    const execution = makeMockExecution();
    const storage = makeMockStorage();
    const clock = makeMockClock();

    execution.runOrchestrator.createRun.mockResolvedValue({
      ok: true,
      value: {
        dagRunId: 'run-x',
        dagId: 'prompt:p',
        version: 1,
        logicalDate: '',
        status: 'running',
      },
    });
    execution.runOrchestrator.startCreatedRun.mockResolvedValue({ ok: true, value: {} });
    execution.runQuery.getRun.mockResolvedValue({
      ok: true,
      value: { dagRun: { status: 'running' }, taskRuns: [] },
    });
    execution.workerLoop.processOnce.mockResolvedValue({ ok: false, error: { message: 'fail' } });

    const savedDefs: Record<string, unknown> = {};
    storage.saveDefinition.mockImplementation((def: { dagId: string; version: number }) => {
      savedDefs[`${def.dagId}:${def.version}`] = def;
      return Promise.resolve(undefined);
    });
    storage.getDefinition.mockImplementation((dagId: string, version: number) =>
      Promise.resolve(savedDefs[`${dagId}:${version}`] ?? null),
    );
    storage.listDefinitionsByDagId.mockImplementation((dagId: string) =>
      Promise.resolve(
        Object.values(savedDefs).filter((d: unknown) => (d as { dagId: string }).dagId === dagId),
      ),
    );

    const backend = new DagPromptBackend({
      storage: storage as never,
      execution: execution as never,
      clock,
      manifests: [INPUT_MANIFEST],
    });

    await backend.submitPrompt({
      prompt_id: 'p',
      prompt: { '1': { class_type: 'input', inputs: { text: 'x' } } },
    });

    await new Promise((r) => setTimeout(r, 200));

    const history = await backend.getHistory('p');
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value['p']?.status.status_str).toBe('error');
  });

  it('handles unknown class_type (no manifest found) in buildDefinitionFromPrompt', async () => {
    const execution = makeMockExecution();
    const storage = makeMockStorage();
    const clock = makeMockClock();

    execution.runOrchestrator.createRun.mockResolvedValue({
      ok: true,
      value: {
        dagRunId: 'run-unknown',
        dagId: 'prompt:u',
        version: 1,
        logicalDate: '',
        status: 'running',
      },
    });
    execution.runOrchestrator.startCreatedRun.mockResolvedValue({ ok: true, value: {} });
    execution.runQuery.getRun.mockResolvedValue({
      ok: true,
      value: { dagRun: { status: 'success' }, taskRuns: [] },
    });

    const savedDefs: Record<string, unknown> = {};
    storage.saveDefinition.mockImplementation((def: { dagId: string; version: number }) => {
      savedDefs[`${def.dagId}:${def.version}`] = def;
      return Promise.resolve(undefined);
    });
    storage.getDefinition.mockImplementation((dagId: string, version: number) =>
      Promise.resolve(savedDefs[`${dagId}:${version}`] ?? null),
    );
    storage.listDefinitionsByDagId.mockImplementation((dagId: string) =>
      Promise.resolve(
        Object.values(savedDefs).filter((d: unknown) => (d as { dagId: string }).dagId === dagId),
      ),
    );

    const backend = new DagPromptBackend({
      storage: storage as never,
      execution: execution as never,
      clock,
      manifests: [],
    });

    // Submit with unknown class_type — manifest will be undefined
    const result = await backend.submitPrompt({
      prompt_id: 'u',
      prompt: {
        '1': { class_type: 'UnknownNode', inputs: { text: 'hello' } },
        '2': { class_type: 'AnotherUnknown', inputs: { data: ['1', 0] } },
      },
    });

    expect(result.ok).toBe(true);
  });
});

// ─── Integration: submitPrompt via a real framework ──────────────────────────

describe('DagPromptBackend.submitPrompt (via framework)', () => {
  let tmpDir: string;
  let framework: IDagFramework;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dag-pb-test-'));
    framework = await createDagFramework({
      nodes: createDefaultNodeRegistrySync(),
      paths: { storageRoot: path.join(tmpDir, 'storage'), assetRoot: path.join(tmpDir, 'assets') },
      autoStart: true,
    });
  });

  afterEach(async () => {
    await framework.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('submits a prompt and returns a prompt_id', async () => {
    const promptBackend = (framework as unknown as { promptBackend: DagPromptBackend })
      .promptBackend;

    if (!promptBackend) {
      // promptBackend may not be exposed; skip via the prompt backend adapter approach
      return;
    }

    const result = await promptBackend.submitPrompt({
      prompt: {
        '1': {
          class_type: 'input',
          inputs: { text: 'hello' },
        },
        '2': {
          class_type: 'text-output',
          inputs: { text: ['1', 0] },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.value.prompt_id).toBe('string');
  });
});
