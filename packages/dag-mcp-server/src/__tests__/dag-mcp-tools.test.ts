import { describe, expect, it } from 'vitest';
import type {
  IDagOrchestrationAssetContentDownloadInfo,
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationCostMetaPreviewRequest,
  IDagOrchestrationCostMetaValidateRequest,
  IDagOrchestrationHttpClient,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  IDagOrchestrationPublishedWorkflowRunRequest,
  TDagOrchestrationCreateRunDraftRequest,
  TDagOrchestrationCostMetaRequest,
  TDagOrchestrationReplaceRunDraftRequest,
} from '@robota-sdk/dag-orchestration-client';
import type { IDagDefinition, IPartialRunRequest, TPortPayload } from '@robota-sdk/dag-core';
import { callDagMcpTool, createDagMcpToolDefinitions } from '../dag-mcp-tools.js';

interface ICapturedCall {
  readonly method: string;
  readonly payload?: object;
}

class FakeDagClient implements IDagOrchestrationHttpClient {
  public readonly calls: ICapturedCall[] = [];

  public async listDefinitions(input?: { readonly dagId?: string }) {
    this.calls.push({ method: 'listDefinitions', payload: input });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { items: [] } } };
  }

  public async getDefinition(dagId: string, version?: number) {
    this.calls.push({ method: 'getDefinition', payload: { dagId, version } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { definition: {} } } };
  }

  public async createDefinition(definition: IDagDefinition) {
    this.calls.push({ method: 'createDefinition', payload: { definition } });
    return { ok: true, status: 201, payload: { ok: true, status: 201, data: { definition } } };
  }

  public async updateDraft(input: {
    readonly dagId: string;
    readonly version: number;
    readonly definition: IDagDefinition;
  }) {
    this.calls.push({ method: 'updateDraft', payload: input });
    return {
      ok: true,
      status: 200,
      payload: { ok: true, status: 200, data: { definition: input.definition } },
    };
  }

  public async validateDefinition(dagId: string, version: number) {
    this.calls.push({ method: 'validateDefinition', payload: { dagId, version } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { valid: true } } };
  }

  public async publishDefinition(dagId: string, version?: number) {
    this.calls.push({ method: 'publishDefinition', payload: { dagId, version } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { definition: {} } } };
  }

  public async listNodes() {
    this.calls.push({ method: 'listNodes' });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: {} } };
  }

  public async createRun(input: {
    readonly definition: IDagDefinition;
    readonly input?: TPortPayload;
    readonly partialRun?: IPartialRunRequest;
  }) {
    this.calls.push({ method: 'createRun', payload: input });
    return {
      ok: true,
      status: 201,
      payload: { ok: true, status: 201, data: { preparationId: 'prep-1' } },
    };
  }

  public async startRun(preparationId: string) {
    this.calls.push({ method: 'startRun', payload: { preparationId } });
    return {
      ok: true,
      status: 202,
      payload: { ok: true, status: 202, data: { dagRunId: 'run-1' } },
    };
  }

  public async getRunStatus(dagRunId: string) {
    this.calls.push({ method: 'getRunStatus', payload: { dagRunId } });
    return {
      ok: true,
      status: 200,
      payload: { ok: true, status: 200, data: { status: 'queued' } },
    };
  }

  public async getRunResult(dagRunId: string) {
    this.calls.push({ method: 'getRunResult', payload: { dagRunId } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { run: {} } } };
  }

  public async uploadAsset(input: IDagOrchestrationAssetUploadRequest) {
    this.calls.push({ method: 'uploadAsset', payload: input });
    return {
      ok: true,
      status: 201,
      payload: { ok: true, status: 201, data: { asset: { assetId: 'asset-1' } } },
    };
  }

  public async getAssetMetadata(assetId: string) {
    this.calls.push({ method: 'getAssetMetadata', payload: { assetId } });
    return {
      ok: true,
      status: 200,
      payload: { ok: true, status: 200, data: { asset: { assetId } } },
    };
  }

  public getAssetContentDownloadInfo(assetId: string): IDagOrchestrationAssetContentDownloadInfo {
    this.calls.push({ method: 'getAssetContentDownloadInfo', payload: { assetId } });
    return {
      assetId,
      url: `http://test.invalid/v1/dag/assets/${assetId}/content`,
      method: 'GET',
      responseType: 'binary',
      contentTypeHeader: 'Content-Type',
      contentDispositionHeader: 'Content-Disposition',
    };
  }

  public async listCostMeta() {
    this.calls.push({ method: 'listCostMeta' });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { items: [] } } };
  }

  public async getCostMeta(nodeType: string) {
    this.calls.push({ method: 'getCostMeta', payload: { nodeType } });
    return {
      ok: true,
      status: 200,
      payload: { ok: true, status: 200, data: { meta: { nodeType } } },
    };
  }

  public async createCostMeta(input: TDagOrchestrationCostMetaRequest) {
    this.calls.push({ method: 'createCostMeta', payload: input });
    return { ok: true, status: 201, payload: { ok: true, status: 201, data: { meta: input } } };
  }

  public async updateCostMeta(nodeType: string, input: TDagOrchestrationCostMetaRequest) {
    this.calls.push({ method: 'updateCostMeta', payload: { nodeType, input } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { meta: input } } };
  }

  public async deleteCostMeta(nodeType: string) {
    this.calls.push({ method: 'deleteCostMeta', payload: { nodeType } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { nodeType } } };
  }

  public async validateCostMetaFormula(input: IDagOrchestrationCostMetaValidateRequest) {
    this.calls.push({ method: 'validateCostMetaFormula', payload: input });
    return {
      ok: true,
      status: 200,
      payload: { ok: true, status: 200, data: { valid: true, errors: [] } },
    };
  }

  public async previewCostMetaFormula(input: IDagOrchestrationCostMetaPreviewRequest) {
    this.calls.push({ method: 'previewCostMetaFormula', payload: input });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { result: 1 } } };
  }

  public async createRunDraft(input: TDagOrchestrationCreateRunDraftRequest) {
    this.calls.push({ method: 'createRunDraft', payload: input });
    return { ok: true, status: 201, payload: { ok: true, status: 201, data: { draft: input } } };
  }

  public async getRunDraft(draftId: string) {
    this.calls.push({ method: 'getRunDraft', payload: { draftId } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { draft: {} } } };
  }

  public async replaceRunDraft(draftId: string, input: TDagOrchestrationReplaceRunDraftRequest) {
    this.calls.push({ method: 'replaceRunDraft', payload: { draftId, input } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { draft: input } } };
  }

  public async resetRunDraftNodeResult(draftId: string, nodeId: string) {
    this.calls.push({ method: 'resetRunDraftNodeResult', payload: { draftId, nodeId } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { draft: {} } } };
  }

  public async overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  ) {
    this.calls.push({ method: 'overwriteRunDraftNodeResult', payload: { draftId, nodeId, input } });
    return { ok: true, status: 200, payload: { ok: true, status: 200, data: { draft: {} } } };
  }

  public async startPublishedWorkflowRun(
    dagId: string,
    input?: IDagOrchestrationPublishedWorkflowRunRequest,
    version?: number,
  ) {
    this.calls.push({ method: 'startPublishedWorkflowRun', payload: { dagId, input, version } });
    return {
      ok: true,
      status: 202,
      payload: {
        ok: true,
        status: 202,
        data: { dagRunId: 'run-1', preparationId: 'prep-1', dagId, version: version ?? 1 },
      },
    };
  }
}

function createDefinition(): IDagDefinition {
  return {
    dagId: 'demo',
    version: 1,
    status: 'draft',
    nodes: [],
    edges: [],
  };
}

function createCostMeta(): TDagOrchestrationCostMetaRequest {
  return {
    nodeType: 'llm text openai',
    displayName: 'OpenAI text node',
    category: 'ai-inference',
    estimateFormula: 'baseCost + tokens * perToken',
    variables: { baseCost: 1, perToken: 0.01 },
    enabled: true,
    updatedAt: '2026-05-05T00:00:00.000Z',
  };
}

describe('DAG MCP tools', () => {
  it('registers tools for the current orchestrator HTTP surface', () => {
    const toolNames = createDagMcpToolDefinitions().map((tool) => tool.name);

    expect(toolNames).toEqual([
      'dag_definitions_list',
      'dag_definitions_get',
      'dag_definitions_create',
      'dag_definitions_update_draft',
      'dag_definitions_validate',
      'dag_definitions_publish',
      'dag_nodes_list',
      'dag_assets_upload',
      'dag_assets_get_metadata',
      'dag_assets_get_content_info',
      'dag_cost_meta_list',
      'dag_cost_meta_get',
      'dag_cost_meta_create',
      'dag_cost_meta_update',
      'dag_cost_meta_delete',
      'dag_cost_meta_validate_formula',
      'dag_cost_meta_preview_formula',
      'dag_runs_create',
      'dag_runs_start',
      'dag_runs_status',
      'dag_runs_result',
      'dag_run_drafts_create',
      'dag_run_drafts_get',
      'dag_run_drafts_replace',
      'dag_run_drafts_reset_node_result',
      'dag_run_drafts_overwrite_node_result',
      'dag_workflows_start_run',
    ]);
  });

  it('dispatches run creation with partial run payloads', async () => {
    const client = new FakeDagClient();
    const definition = createDefinition();

    const result = await callDagMcpTool(
      'dag_runs_create',
      { definition, input: { prompt: 'hello' }, partialStartNodeId: 'node-a' },
      client,
    );

    expect(result.isError).toBe(false);
    expect(client.calls[0]).toEqual({
      method: 'createRun',
      payload: {
        definition,
        input: { prompt: 'hello' },
        partialRun: { startNodeId: 'node-a' },
      },
    });
  });

  it('returns MCP errors without calling the server when required arguments are missing', async () => {
    const client = new FakeDagClient();

    const result = await callDagMcpTool('dag_definitions_get', {}, client);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('dagId is required');
    expect(client.calls).toHaveLength(0);
  });

  it('dispatches run draft tools through the orchestration client', async () => {
    const client = new FakeDagClient();
    const draft = {
      draftId: 'draft-1',
      definition: createDefinition(),
      input: { prompt: 'hello' },
    };
    const resultPayload = {
      input: { prompt: 'hello' },
      output: { text: 'done' },
    };

    await callDagMcpTool('dag_run_drafts_create', { draft }, client);
    await callDagMcpTool('dag_run_drafts_get', { draftId: 'draft-1' }, client);
    await callDagMcpTool('dag_run_drafts_replace', { draftId: 'draft-1', draft }, client);
    await callDagMcpTool(
      'dag_run_drafts_reset_node_result',
      { draftId: 'draft-1', nodeId: 'source' },
      client,
    );
    await callDagMcpTool(
      'dag_run_drafts_overwrite_node_result',
      { draftId: 'draft-1', nodeId: 'source', result: resultPayload },
      client,
    );

    expect(client.calls.slice(-5)).toEqual([
      { method: 'createRunDraft', payload: draft },
      { method: 'getRunDraft', payload: { draftId: 'draft-1' } },
      { method: 'replaceRunDraft', payload: { draftId: 'draft-1', input: draft } },
      { method: 'resetRunDraftNodeResult', payload: { draftId: 'draft-1', nodeId: 'source' } },
      {
        method: 'overwriteRunDraftNodeResult',
        payload: { draftId: 'draft-1', nodeId: 'source', input: resultPayload },
      },
    ]);
  });

  it('dispatches published workflow starts with version and overrides', async () => {
    const client = new FakeDagClient();
    const request: IDagOrchestrationPublishedWorkflowRunRequest = {
      input: { prompt: 'hello' },
      overrides: {
        source: {
          template: 'override prompt',
        },
      },
    };

    const result = await callDagMcpTool(
      'dag_workflows_start_run',
      { dagId: 'published dag', version: 3, request },
      client,
    );

    expect(result.isError).toBe(false);
    expect(client.calls.at(-1)).toEqual({
      method: 'startPublishedWorkflowRun',
      payload: { dagId: 'published dag', input: request, version: 3 },
    });
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      status: 202,
      data: { dagRunId: 'run-1', dagId: 'published dag', version: 3 },
    });
  });

  it('dispatches asset tools and exposes content download info without binary payloads', async () => {
    const client = new FakeDagClient();
    const asset = {
      fileName: 'photo.png',
      mediaType: 'image/png',
      base64Data: 'AQIDBA==',
    };

    await callDagMcpTool('dag_assets_upload', { asset }, client);
    await callDagMcpTool('dag_assets_get_metadata', { assetId: 'asset 1' }, client);
    const contentInfo = await callDagMcpTool(
      'dag_assets_get_content_info',
      { assetId: 'asset 1' },
      client,
    );

    expect(client.calls.slice(-3)).toEqual([
      { method: 'uploadAsset', payload: asset },
      { method: 'getAssetMetadata', payload: { assetId: 'asset 1' } },
      { method: 'getAssetContentDownloadInfo', payload: { assetId: 'asset 1' } },
    ]);
    expect(contentInfo.isError).toBe(false);
    expect(JSON.parse(contentInfo.content[0]?.text ?? '{}')).toMatchObject({
      assetId: 'asset 1',
      url: 'http://test.invalid/v1/dag/assets/asset 1/content',
      responseType: 'binary',
    });
  });

  it('dispatches cost metadata tools through the orchestration client', async () => {
    const client = new FakeDagClient();
    const meta = createCostMeta();

    await callDagMcpTool('dag_cost_meta_list', {}, client);
    await callDagMcpTool('dag_cost_meta_get', { nodeType: meta.nodeType }, client);
    await callDagMcpTool('dag_cost_meta_create', { meta }, client);
    await callDagMcpTool('dag_cost_meta_update', { nodeType: meta.nodeType, meta }, client);
    await callDagMcpTool('dag_cost_meta_delete', { nodeType: meta.nodeType }, client);
    await callDagMcpTool(
      'dag_cost_meta_validate_formula',
      { formula: meta.estimateFormula },
      client,
    );
    const preview = await callDagMcpTool(
      'dag_cost_meta_preview_formula',
      {
        formula: meta.estimateFormula,
        variables: meta.variables,
        testContext: { tokens: 200 },
      },
      client,
    );

    expect(client.calls.slice(-7)).toEqual([
      { method: 'listCostMeta' },
      { method: 'getCostMeta', payload: { nodeType: meta.nodeType } },
      { method: 'createCostMeta', payload: meta },
      { method: 'updateCostMeta', payload: { nodeType: meta.nodeType, input: meta } },
      { method: 'deleteCostMeta', payload: { nodeType: meta.nodeType } },
      { method: 'validateCostMetaFormula', payload: { formula: meta.estimateFormula } },
      {
        method: 'previewCostMetaFormula',
        payload: {
          formula: meta.estimateFormula,
          variables: meta.variables,
          testContext: { tokens: 200 },
        },
      },
    ]);
    expect(preview.isError).toBe(false);
    expect(JSON.parse(preview.content[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      status: 200,
      data: { result: 1 },
    });
  });

  it('rejects cost metadata MCP calls with missing required arguments', async () => {
    const client = new FakeDagClient();

    const result = await callDagMcpTool(
      'dag_cost_meta_update',
      { nodeType: 'missing meta' },
      client,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('meta is required');
    expect(client.calls).toHaveLength(0);
  });
});
