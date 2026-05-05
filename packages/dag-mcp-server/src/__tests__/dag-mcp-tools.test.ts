import { describe, expect, it } from 'vitest';
import type {
  IDagOrchestrationAssetContentDownloadInfo,
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationHttpClient,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  IDagOrchestrationPublishedWorkflowRunRequest,
  TDagOrchestrationCreateRunDraftRequest,
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
      'dag_runs_create',
      'dag_runs_start',
      'dag_runs_status',
      'dag_runs_result',
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
});
