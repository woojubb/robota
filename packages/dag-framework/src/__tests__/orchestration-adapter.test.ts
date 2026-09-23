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

it('exposes run lifecycle through a domain capability without an HTTP client', async () => {
  expect('client' in framework).toBe(false);
  const run = await framework.runs.getRun('missing');
  expect(run).toMatchObject({ ok: false, error: { code: expect.any(String) } });
  expect(run).not.toHaveProperty('status');
});

describe('listDefinitions', () => {
  it('exposes definition reads as domain data outside the HTTP port', async () => {
    expect('listDefinitions' in framework.runs).toBe(false);
    expect('getDefinition' in framework.runs).toBe(false);
    expect(await framework.definitionReads.listDefinitions()).toEqual([]);
    expect(await framework.definitionReads.getDefinition('missing')).toBeUndefined();
  });

  it('returns empty list initially', async () => {
    expect(await framework.definitionReads.listDefinitions()).toEqual([]);
  });

  it('returns created definition', async () => {
    await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    const items = await framework.definitionReads.listDefinitions('test-dag');
    expect(items).toEqual([{ dagId: 'test-dag', latestVersion: 1, statuses: ['draft'] }]);
  });
});

describe('createDefinition + getDefinition', () => {
  it('exposes definition mutations as domain results outside the HTTP port', async () => {
    expect('createDefinition' in framework.runs).toBe(false);
    expect('updateDraft' in framework.runs).toBe(false);
    expect('validateDefinition' in framework.runs).toBe(false);
    expect('publishDefinition' in framework.runs).toBe(false);
    const created = await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    expect(created).toMatchObject({ ok: true, value: { dagId: 'test-dag', status: 'draft' } });
    expect(created).not.toHaveProperty('status');
  });

  it('creates and retrieves a definition', async () => {
    const created = await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    expect(created.ok).toBe(true);
    expect(created).not.toHaveProperty('status');

    const got = await framework.definitionReads.getDefinition('test-dag', 1);
    expect(got?.dagId).toBe('test-dag');
  });

  it('does not let mutation callers change a stored definition through input or result', async () => {
    const input = structuredClone(MINIMAL_DEFINITION);
    const created = await framework.definitionMutations.createDefinition(input);
    if (!created.ok) throw new Error('Expected a created definition.');
    input.nodes[0]!.nodeType = 'input-mutated';
    created.value.nodes[0]!.nodeType = 'result-mutated';
    expect((await framework.definitionReads.getDefinition('test-dag', 1))?.nodes[0]?.nodeType).toBe(
      'input',
    );
  });

  it('returns undefined for a missing definition', async () => {
    expect(await framework.definitionReads.getDefinition('no-such-dag')).toBeUndefined();
  });

  it('does not let callers mutate the stored definition through a read result', async () => {
    await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    const first = await framework.definitionReads.getDefinition('test-dag', 1);
    if (!first) throw new Error('Expected definition.');
    first.nodes[0]!.nodeType = 'changed-by-caller';
    expect((await framework.definitionReads.getDefinition('test-dag', 1))?.nodes[0]?.nodeType).toBe(
      'input',
    );
  });
});

describe('publishDefinition', () => {
  it('publishes a draft definition', async () => {
    await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.definitionMutations.publishDefinition('test-dag', 1);
    expect(res.ok).toBe(true);
  });
});

describe('listNodes', () => {
  it('exposes registered manifests through a domain catalog instead of the HTTP port', async () => {
    expect('listNodes' in framework.runs).toBe(false);
    const manifests = await framework.catalog.listNodes();
    expect(manifests.find((manifest) => manifest.nodeType === 'input')?.displayName).toBeDefined();
  });

  it('does not let catalog callers change registered node metadata', async () => {
    const manifests = await framework.catalog.listNodes();
    const input = manifests.find((manifest) => manifest.nodeType === 'input');
    if (!input) throw new Error('Missing input manifest.');
    const withInputPort = manifests.find((manifest) => manifest.inputs.length > 0);
    if (!withInputPort) throw new Error('Missing manifest with an input port.');
    const portNodeType = withInputPort.nodeType;
    const originalPortKey = withInputPort.inputs[0]!.key;
    const withSchema = manifests.find((manifest) => manifest.configSchema);
    if (!withSchema?.configSchema) throw new Error('Missing manifest configuration schema.');
    const schemaNodeType = withSchema.nodeType;
    input.nodeType = 'changed-by-caller';
    withInputPort.inputs[0]!.key = 'changed-by-caller';
    withSchema.configSchema['changedByCaller'] = true;

    const secondRead = await framework.catalog.listNodes();
    expect(secondRead.some((manifest) => manifest.nodeType === 'input')).toBe(true);
    expect(secondRead.find((manifest) => manifest.nodeType === portNodeType)?.inputs[0]?.key).toBe(
      originalPortKey,
    );
    expect(
      secondRead.find((manifest) => manifest.nodeType === schemaNodeType)?.configSchema,
    ).not.toHaveProperty('changedByCaller');
    expect((await framework.validation.validateDag(MINIMAL_DEFINITION)).valid).toBe(true);
  });

  it('returns the registered node manifests', async () => {
    const manifests = await framework.catalog.listNodes();
    const types = manifests.map((manifest) => manifest.nodeType);
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

describe('updateDraft', () => {
  it('updates an existing draft definition', async () => {
    await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.definitionMutations.updateDraft({
      ...MINIMAL_DEFINITION,
      nodes: [...MINIMAL_DEFINITION.nodes],
    });
    expect(res.ok).toBe(true);
  });
});

describe('validateDefinition', () => {
  it('validates a created draft definition', async () => {
    await framework.definitionMutations.createDefinition(MINIMAL_DEFINITION);
    const res = await framework.definitionMutations.validateDefinition('test-dag', 1);
    expect(res.ok).toBe(true);
  });

  it('returns non-200 for missing definition', async () => {
    const res = await framework.definitionMutations.validateDefinition('no-such-dag', 1);
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
  it('stores bytes and streams them without HTTP envelopes', async () => {
    const content = Buffer.from('hello asset');
    const uploaded = await framework.assets.save({
      content,
      fileName: 'hello.txt',
      mediaType: 'text/plain',
    });
    const assetId = uploaded.assetId;
    expect(typeof assetId).toBe('string');

    const meta = await framework.assets.getMetadata(assetId);
    expect(meta?.fileName).toBe('hello.txt');
    const contentResult = await framework.assets.getContent(assetId);
    expect(contentResult).toBeDefined();
    if (!contentResult) return;
    const chunks: Uint8Array[] = [];
    for await (const chunk of contentResult.stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('hello asset');
  });

  it('returns undefined for an unknown assetId', async () => {
    expect(await framework.assets.getMetadata('no-such-asset-id')).toBeUndefined();
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
  it('exposes build as a domain capability separate from the HTTP-shaped orchestration port', async () => {
    expect('buildDag' in framework.runs).toBe(false);
    const result = await framework.build.buildDag({
      pipeline: [{ nodeType: 'input', config: { text: 'hello' } }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.definition.nodes).toHaveLength(1);
  });

  it('builds a DAG from a valid pipeline spec', async () => {
    const res = await framework.build.buildDag({
      pipeline: [
        { nodeType: 'input', config: { text: 'hello' } },
        { nodeType: 'text-output', config: {} },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.definition.nodes.length).toBe(2);
  });

  it('returns a domain validation error for an unknown node type', async () => {
    const res = await framework.build.buildDag({
      pipeline: [{ nodeType: 'no-such-node-type-xyz', config: {} }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('UNKNOWN_NODE_TYPE');
  });
});

describe('validateDag', () => {
  it('exposes validation as a domain result separate from the HTTP-shaped orchestration port', async () => {
    expect('validateDag' in framework.runs).toBe(false);
    expect(await framework.validation.validateDag(MINIMAL_DEFINITION)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('returns valid:true for a known-type definition', async () => {
    const res = await framework.validation.validateDag(MINIMAL_DEFINITION);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns errors for unknown node type', async () => {
    const badDef: IDagDefinition = {
      ...MINIMAL_DEFINITION,
      nodes: [{ nodeId: 'x', nodeType: 'unknown-type-xyz', dependsOn: [], config: {} }],
      edges: [],
    };
    const res = await framework.validation.validateDag(badDef);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Unknown node type "unknown-type-xyz" for node "x"');
  });

  it('returns errors for edge referencing unknown node', async () => {
    const badDef: IDagDefinition = {
      ...MINIMAL_DEFINITION,
      edges: [{ from: 'n1', to: 'no-such-node', bindings: [] }],
    };
    const res = await framework.validation.validateDag(badDef);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Edge references unknown target node "no-such-node"');
  });
});

describe('publishDefinition domain errors', () => {
  it('returns a domain error when the requested definition does not exist', async () => {
    const res = await framework.definitionMutations.publishDefinition('nonexistent-dag', 1);
    expect(res).toMatchObject({
      ok: false,
      error: [{ code: 'DAG_VALIDATION_DEFINITION_NOT_FOUND' }],
    });
  });
});

describe('startPublishedWorkflowRun', () => {
  it('returns error when DAG does not exist', async () => {
    const res = await framework.runs.startPublishedWorkflowRun('no-dag');
    expect(res.ok).toBe(false);
  });
});
