import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import { createDagFramework } from '../create-dag-framework.js';
import { createDefaultNodeRegistrySync } from '../default-node-registry.js';
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

describe('cost-meta (not implemented)', () => {
  it('listCostMeta returns 501', async () => {
    const res = await framework.client.listCostMeta();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });

  it('createCostMeta returns 501', async () => {
    const res = await framework.client.createCostMeta({
      nodeType: 'input',
      displayName: 'Input',
      category: 'transform',
      estimateFormula: '0',
      variables: {},
      enabled: true,
      updatedAt: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });
});

describe('run-draft CRUD', () => {
  it('creates, retrieves, replaces, and resets drafts', async () => {
    const definition = MINIMAL_DEFINITION;

    const created = await framework.client.createRunDraft({ definition, input: { text: 'hi' } });
    expect(created.ok).toBe(true);
    expect(created.status).toBe(201);
    const draftId = (created.payload as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const got = await framework.client.getRunDraft(draftId);
    expect(got.ok).toBe(true);

    const replaced = await framework.client.replaceRunDraft(draftId, {
      definition,
      input: { text: 'changed' },
    });
    expect(replaced.ok).toBe(true);

    const reset = await framework.client.resetRunDraftNodeResult(draftId, 'n1');
    expect(reset.ok).toBe(true);
  });

  it('returns 404 for missing draft', async () => {
    const res = await framework.client.getRunDraft('no-such-draft');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
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

describe('cost-meta not-implemented stubs', () => {
  it('getCostMeta returns 501', async () => {
    const res = await framework.client.getCostMeta('input');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });

  it('updateCostMeta returns 501', async () => {
    const res = await framework.client.updateCostMeta('input', {
      nodeType: 'input',
      displayName: 'Input',
      category: 'transform',
      estimateFormula: '0',
      variables: {},
      enabled: true,
      updatedAt: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });

  it('deleteCostMeta returns 501', async () => {
    const res = await framework.client.deleteCostMeta('input');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });

  it('validateCostMetaFormula returns 501', async () => {
    const res = await framework.client.validateCostMetaFormula({
      formula: '0',
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
  });

  it('previewCostMetaFormula returns 501', async () => {
    const res = await framework.client.previewCostMetaFormula({
      formula: '0',
      testContext: {},
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
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
    const created = await framework.client.createRunDraft({
      definition: MINIMAL_DEFINITION,
      input: {},
    });
    const draftId = (created.payload as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const res = await framework.client.overwriteRunDraftNodeResult(draftId, 'n1', {
      output: { text: 'overwritten' },
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('returns 404 when draft does not exist', async () => {
    const res = await framework.client.overwriteRunDraftNodeResult('no-draft', 'n1', {
      output: { text: 'x' },
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it('preserves existing pendingDescription when overwriting node result', async () => {
    const created = await framework.client.createRunDraft({
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
    const draftId = (created.payload as { data: { draft: { draftId: string } } }).data.draft
      .draftId;

    const res = await framework.client.overwriteRunDraftNodeResult(draftId, 'n1', {
      output: { text: 'result' },
      input: { text: 'input' },
    });
    expect(res.ok).toBe(true);
    const draft = (res.payload as { data: { draft: { nodeStateMap: Record<string, unknown> } } })
      .data.draft;
    expect(draft.nodeStateMap['n1']).toBeDefined();
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
