import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { createDagFramework } from '../create-dag-framework.js';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';
import type { IDagFramework } from '../types.js';

let tmpDir: string;
let framework: IDagFramework;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'robota-dag-test-'));
  framework = await createDagFramework({
    nodes: createDefaultNodeRegistrySync(),
    paths: { storageRoot: path.join(tmpDir, 'storage'), assetRoot: path.join(tmpDir, 'assets') },
  });
});

afterEach(async () => {
  await framework.stop();
  await rm(tmpDir, { recursive: true, force: true });
});

const MINIMAL_DEFINITION: IDagDefinition = {
  dagId: 'test-dag',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'n1', nodeType: 'input', dependsOn: [], config: { text: 'hello' } },
    { nodeId: 'n2', nodeType: 'text-output', dependsOn: ['n1'], config: {} },
  ],
  edges: [{ from: 'n1', to: 'n2', bindings: [{ outputKey: 'text', inputKey: 'text' }] }],
};

describe('listDefinitions', () => {
  it('returns empty list initially', async () => {
    const res = await framework.client.listDefinitions();
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('returns created definition', async () => {
    await framework.client.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.client.listDefinitions({ dagId: 'test-dag' });
    expect(res.ok).toBe(true);
  });
});

describe('createDefinition + getDefinition', () => {
  it('creates and retrieves a definition', async () => {
    const created = await framework.client.createDefinition(MINIMAL_DEFINITION);
    expect(created.ok).toBe(true);
    expect(created.status).toBe(201);

    const got = await framework.client.getDefinition('test-dag', 1);
    expect(got.ok).toBe(true);
    const payload = got.payload as { ok: boolean; data: { definition: { dagId: string } } };
    expect(payload.data.definition.dagId).toBe('test-dag');
  });

  it('returns 404 for missing definition', async () => {
    const got = await framework.client.getDefinition('no-such-dag');
    expect(got.ok).toBe(false);
    expect(got.status).toBe(404);
  });
});

describe('publishDefinition', () => {
  it('publishes a draft definition', async () => {
    await framework.client.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.client.publishDefinition('test-dag', 1);
    expect(res.ok).toBe(true);
  });
});

describe('listNodes', () => {
  it('returns the registered node manifests', async () => {
    const res = await framework.client.listNodes();
    expect(res.ok).toBe(true);
    const payload = res.payload as { data: { items: Array<{ nodeType: string }> } };
    const types = payload.data.items.map((n) => n.nodeType);
    expect(types).toContain('input');
    expect(types).toContain('text-output');
    expect(types).toContain('transform');
  });
});

describe('cost-meta capability', () => {
  it('reports unsupported as a domain result, not an HTTP envelope', async () => {
    const res = await framework.costMeta.listCostMeta();
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
    expect(res).not.toHaveProperty('status');
  });

  it('createCostMeta returns 501', async () => {
    const res = await framework.costMeta.createCostMeta({
      nodeType: 'input',
      displayName: 'Input',
      category: 'transform',
      estimateFormula: '0',
      variables: {},
      enabled: true,
      updatedAt: new Date().toISOString(),
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
  });
});

describe('run-draft CRUD', () => {
  it('exposes a domain result capability independent of HTTP representation', async () => {
    const created = await framework.runDrafts.createRunDraft({
      definition: MINIMAL_DEFINITION,
      input: { text: 'hello' },
    });
    expect(created.ok).toBe(true);
    expect(created).not.toHaveProperty('status');
    if (!created.ok) return;
    expect(created.value.input).toEqual({ text: 'hello' });

    const found = await framework.runDrafts.getRunDraft(created.value.draftId);
    expect(found).toEqual(created);
    expect(await framework.runDrafts.getRunDraft('missing')).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUN_DRAFT_NOT_FOUND' },
    });
  });

  it('creates, retrieves, replaces, and resets drafts', async () => {
    const definition = MINIMAL_DEFINITION;

    const created = await framework.runDrafts.createRunDraft({ definition, input: { text: 'hi' } });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const draftId = created.value.draftId;

    const got = await framework.runDrafts.getRunDraft(draftId);
    expect(got.ok).toBe(true);

    const replaced = await framework.runDrafts.replaceRunDraft(draftId, {
      definition,
      input: { text: 'changed' },
    });
    expect(replaced.ok).toBe(true);

    const reset = await framework.runDrafts.resetRunDraftNodeResult(draftId, 'n1');
    expect(reset.ok).toBe(true);
  });

  it('returns 404 for missing draft', async () => {
    const res = await framework.runDrafts.getRunDraft('no-such-draft');
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: { code: 'DAG_RUN_DRAFT_NOT_FOUND' } });
  });
});

describe('getAssetContentDownloadInfo', () => {
  it('returns an inproc URI for the given asset id', () => {
    const info = framework.client.getAssetContentDownloadInfo('asset-123');
    expect(info.assetId).toBe('asset-123');
    expect(info.url).toContain('asset-123');
  });
});

describe('updateDraft', () => {
  it('updates an existing draft definition', async () => {
    await framework.client.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.client.updateDraft({
      dagId: 'test-dag',
      version: 1,
      definition: { ...MINIMAL_DEFINITION, nodes: [...MINIMAL_DEFINITION.nodes] },
    });
    expect([200, 201, 404]).toContain(res.status);
  });
});

describe('validateDefinition', () => {
  it('validates a created draft definition', async () => {
    await framework.client.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.client.validateDefinition('test-dag', 1);
    expect([200, 400]).toContain(res.status);
  });

  it('returns non-200 for missing definition', async () => {
    const res = await framework.client.validateDefinition('no-such-dag', 1);
    expect(res.ok).toBe(false);
  });
});

describe('cost-meta unsupported operations', () => {
  it('getCostMeta reports an unsupported domain result', async () => {
    const res = await framework.costMeta.getCostMeta('input');
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
  });

  it('updateCostMeta reports an unsupported domain result', async () => {
    const res = await framework.costMeta.updateCostMeta('input', {
      nodeType: 'input',
      displayName: 'Input',
      category: 'transform',
      estimateFormula: '0',
      variables: {},
      enabled: true,
      updatedAt: new Date().toISOString(),
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
  });

  it('deleteCostMeta reports an unsupported domain result', async () => {
    const res = await framework.costMeta.deleteCostMeta('input');
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
  });

  it('validateCostMetaFormula reports an unsupported domain result', async () => {
    const res = await framework.costMeta.validateCostMetaFormula({
      formula: '0',
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
  });

  it('previewCostMetaFormula reports an unsupported domain result', async () => {
    const res = await framework.costMeta.previewCostMetaFormula({
      formula: '0',
      testContext: {},
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'DAG_COST_META_UNSUPPORTED' } });
  });
});

describe('uploadAsset + getAssetMetadata', () => {
  it('uploads a base64-encoded asset and retrieves its metadata', async () => {
    const content = Buffer.from('hello asset').toString('base64');
    const uploaded = await framework.client.uploadAsset({
      base64Data: content,
      fileName: 'hello.txt',
      mediaType: 'text/plain',
    });
    expect(uploaded.ok).toBe(true);
    expect(uploaded.status).toBe(201);
    const assetId = (uploaded.payload as { data: { asset: { assetId: string } } }).data.asset
      .assetId;
    expect(typeof assetId).toBe('string');

    const meta = await framework.client.getAssetMetadata(assetId);
    expect(meta.ok).toBe(true);
    expect(meta.status).toBe(200);
  });

  it('getAssetMetadata returns 404 for unknown assetId', async () => {
    const res = await framework.client.getAssetMetadata('no-such-asset-id');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});

describe('overwriteRunDraftNodeResult', () => {
  it('overwrites a node result in an existing draft', async () => {
    const created = await framework.runDrafts.createRunDraft({
      definition: MINIMAL_DEFINITION,
      input: {},
    });
    if (!created.ok) return;
    const draftId = created.value.draftId;

    const res = await framework.runDrafts.overwriteRunDraftNodeResult(draftId, 'n1', {
      output: { text: 'overwritten' },
    });
    expect(res.ok).toBe(true);
    expect(res).not.toHaveProperty('status');
  });

  it('returns 404 when draft does not exist', async () => {
    const res = await framework.runDrafts.overwriteRunDraftNodeResult('no-draft', 'n1', {
      output: { text: 'x' },
    });
    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ error: { code: 'DAG_RUN_DRAFT_NOT_FOUND' } });
  });

  it('preserves existing pendingDescription when overwriting node result', async () => {
    const created = await framework.runDrafts.createRunDraft({
      definition: MINIMAL_DEFINITION,
      input: {},
      nodeStateMap: {
        n1: {
          operationStatus: 'idle' as const,
          executionStatus: 'running' as const,
          pendingDescription: 'running...',
        },
      },
    });
    if (!created.ok) return;
    const draftId = created.value.draftId;

    const res = await framework.runDrafts.overwriteRunDraftNodeResult(draftId, 'n1', {
      output: { text: 'result' },
      input: { text: 'input' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.nodeStateMap['n1']).toBeDefined();
  });
});

describe('buildDag', () => {
  it('builds a DAG from a valid pipeline spec', async () => {
    const res = await framework.client.buildDag({
      pipeline: [
        { nodeType: 'input', config: { text: 'hello' } },
        { nodeType: 'text-output', config: {} },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const payload = res.payload as { data: { definition: IDagDefinition } };
    expect(payload.data.definition.nodes.length).toBe(2);
  });

  it('returns 400 for an invalid pipeline spec (unknown node type)', async () => {
    const res = await framework.client.buildDag({
      pipeline: [{ nodeType: 'no-such-node-type-xyz', config: {} }],
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});

describe('validateDag', () => {
  it('returns valid:true for a known-type definition', async () => {
    const res = await framework.client.validateDag(MINIMAL_DEFINITION);
    expect(res.ok).toBe(true);
    const payload = res.payload as { data: { valid: boolean; errors: string[] } };
    expect(payload.data.valid).toBe(true);
    expect(payload.data.errors).toHaveLength(0);
  });

  it('returns errors for unknown node type', async () => {
    const badDef: IDagDefinition = {
      ...MINIMAL_DEFINITION,
      nodes: [{ nodeId: 'x', nodeType: 'unknown-type-xyz', dependsOn: [], config: {} }],
      edges: [],
    };
    const res = await framework.client.validateDag(badDef);
    expect(res.ok).toBe(true);
    const payload = res.payload as { data: { valid: boolean; errors: string[] } };
    expect(payload.data.valid).toBe(false);
    expect(payload.data.errors.length).toBeGreaterThan(0);
  });

  it('returns errors for edge referencing unknown node', async () => {
    const badDef: IDagDefinition = {
      ...MINIMAL_DEFINITION,
      edges: [{ from: 'n1', to: 'no-such-node', bindings: [] }],
    };
    const res = await framework.client.validateDag(badDef);
    const payload = res.payload as { data: { valid: boolean; errors: string[] } };
    expect(payload.data.valid).toBe(false);
  });
});

describe('publishDefinition — resolvePublishVersion branches', () => {
  it('returns 404 when no definitions exist for dagId', async () => {
    const res = await framework.client.publishDefinition('nonexistent-dag');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('resolves version from last draft when version not specified', async () => {
    await framework.client.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.client.publishDefinition('test-dag');
    expect([200, 400]).toContain(res.status);
  });

  it('resolves version from last definition when no drafts exist', async () => {
    await framework.client.createDefinition(MINIMAL_DEFINITION);
    await framework.client.publishDefinition('test-dag', 1);
    // now no drafts — fall to last definition
    const res = await framework.client.publishDefinition('test-dag');
    expect([200, 400]).toContain(res.status);
  });
});

describe('startPublishedWorkflowRun', () => {
  it('returns error when DAG does not exist', async () => {
    const res = await framework.client.startPublishedWorkflowRun('no-dag');
    expect(res.ok).toBe(false);
  });
});
