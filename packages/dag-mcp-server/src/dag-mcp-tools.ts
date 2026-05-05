import type { IDagDefinition, IPartialRunRequest, TPortPayload } from '@robota-sdk/dag-core';
import type {
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
import type { IDagMcpToolCallResult, IDagMcpToolDefinition } from './types.js';
import { DAG_MCP_TOOL_DEFINITIONS } from './tool-definitions.js';
import {
  optionalNumber,
  optionalObject,
  optionalString,
  requireNumber,
  requireObject,
  requireString,
  toMcpResult,
  toToolArgs,
  type TToolArgs,
  type TToolHandler,
  usageError,
} from './tool-runtime.js';

export function createDagMcpToolDefinitions(): readonly IDagMcpToolDefinition[] {
  return DAG_MCP_TOOL_DEFINITIONS;
}

export async function callDagMcpTool(
  toolName: string,
  args: object | null | undefined,
  client: IDagOrchestrationHttpClient,
): Promise<IDagMcpToolCallResult> {
  const handler = handlers[toolName];
  if (!handler) return usageError(`Unknown tool: ${toolName}`);
  return handler(toToolArgs(args), client);
}

const handlers: Record<string, TToolHandler> = {
  dag_definitions_list: async (args, client) => {
    const dagId = optionalString(args, 'dagId');
    return toMcpResult(await client.listDefinitions({ dagId }));
  },
  dag_definitions_get: async (args, client) => {
    const dagId = requireString(args, 'dagId');
    if (!dagId.ok) return usageError(dagId.detail);
    const version = optionalNumber(args, 'version');
    return toMcpResult(await client.getDefinition(dagId.value, version));
  },
  dag_definitions_create: async (args, client) => {
    const definition = requireObject(args, 'definition');
    if (!definition.ok) return usageError(definition.detail);
    return toMcpResult(await client.createDefinition(definition.value as object as IDagDefinition));
  },
  dag_definitions_update_draft: async (args, client) => {
    const dagId = requireString(args, 'dagId');
    if (!dagId.ok) return usageError(dagId.detail);
    const version = requireNumber(args, 'version');
    if (!version.ok) return usageError(version.detail);
    const definition = requireObject(args, 'definition');
    if (!definition.ok) return usageError(definition.detail);
    return toMcpResult(
      await client.updateDraft({
        dagId: dagId.value,
        version: version.value,
        definition: definition.value as object as IDagDefinition,
      }),
    );
  },
  dag_definitions_validate: async (args, client) => {
    const dagId = requireString(args, 'dagId');
    if (!dagId.ok) return usageError(dagId.detail);
    const version = requireNumber(args, 'version');
    if (!version.ok) return usageError(version.detail);
    return toMcpResult(await client.validateDefinition(dagId.value, version.value));
  },
  dag_definitions_publish: async (args, client) => {
    const dagId = requireString(args, 'dagId');
    if (!dagId.ok) return usageError(dagId.detail);
    const version = optionalNumber(args, 'version');
    return toMcpResult(await client.publishDefinition(dagId.value, version));
  },
  dag_nodes_list: async (_args, client) => toMcpResult(await client.listNodes()),
  dag_assets_upload: async (args, client) => {
    const asset = requireObject(args, 'asset');
    if (!asset.ok) return usageError(asset.detail);
    return toMcpResult(
      await client.uploadAsset(asset.value as object as IDagOrchestrationAssetUploadRequest),
    );
  },
  dag_assets_get_metadata: async (args, client) => {
    const assetId = requireString(args, 'assetId');
    if (!assetId.ok) return usageError(assetId.detail);
    return toMcpResult(await client.getAssetMetadata(assetId.value));
  },
  dag_assets_get_content_info: async (args, client) => {
    const assetId = requireString(args, 'assetId');
    if (!assetId.ok) return usageError(assetId.detail);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(client.getAssetContentDownloadInfo(assetId.value), null, 2),
        },
      ],
      isError: false,
    };
  },
  dag_cost_meta_list: async (_args, client) => toMcpResult(await client.listCostMeta()),
  dag_cost_meta_get: async (args, client) => {
    const nodeType = requireString(args, 'nodeType');
    if (!nodeType.ok) return usageError(nodeType.detail);
    return toMcpResult(await client.getCostMeta(nodeType.value));
  },
  dag_cost_meta_create: async (args, client) => {
    const meta = requireObject(args, 'meta');
    if (!meta.ok) return usageError(meta.detail);
    return toMcpResult(
      await client.createCostMeta(meta.value as object as TDagOrchestrationCostMetaRequest),
    );
  },
  dag_cost_meta_update: async (args, client) => {
    const nodeType = requireString(args, 'nodeType');
    if (!nodeType.ok) return usageError(nodeType.detail);
    const meta = requireObject(args, 'meta');
    if (!meta.ok) return usageError(meta.detail);
    return toMcpResult(
      await client.updateCostMeta(
        nodeType.value,
        meta.value as object as TDagOrchestrationCostMetaRequest,
      ),
    );
  },
  dag_cost_meta_delete: async (args, client) => {
    const nodeType = requireString(args, 'nodeType');
    if (!nodeType.ok) return usageError(nodeType.detail);
    return toMcpResult(await client.deleteCostMeta(nodeType.value));
  },
  dag_cost_meta_validate_formula: async (args, client) => {
    const formula = requireString(args, 'formula');
    if (!formula.ok) return usageError(formula.detail);
    const request: IDagOrchestrationCostMetaValidateRequest = { formula: formula.value };
    return toMcpResult(await client.validateCostMetaFormula(request));
  },
  dag_cost_meta_preview_formula: async (args, client) => {
    const formula = requireString(args, 'formula');
    if (!formula.ok) return usageError(formula.detail);
    const variables = optionalObject(args, 'variables');
    const testContext = optionalObject(args, 'testContext');
    const request: IDagOrchestrationCostMetaPreviewRequest = {
      formula: formula.value,
      variables: variables as object as IDagOrchestrationCostMetaPreviewRequest['variables'],
      testContext: testContext as object as IDagOrchestrationCostMetaPreviewRequest['testContext'],
    };
    return toMcpResult(await client.previewCostMetaFormula(request));
  },
  dag_runs_create: async (args, client) => {
    const definition = requireObject(args, 'definition');
    if (!definition.ok) return usageError(definition.detail);
    const input = optionalObject(args, 'input');
    const partialStartNodeId = optionalString(args, 'partialStartNodeId');
    const partialRun: IPartialRunRequest | undefined = partialStartNodeId
      ? { startNodeId: partialStartNodeId }
      : undefined;
    return toMcpResult(
      await client.createRun({
        definition: definition.value as object as IDagDefinition,
        input: input as TPortPayload | undefined,
        partialRun,
      }),
    );
  },
  dag_runs_start: async (args, client) => {
    const preparationId = requireString(args, 'preparationId');
    if (!preparationId.ok) return usageError(preparationId.detail);
    return toMcpResult(await client.startRun(preparationId.value));
  },
  dag_runs_status: async (args, client) => {
    const dagRunId = requireString(args, 'dagRunId');
    if (!dagRunId.ok) return usageError(dagRunId.detail);
    return toMcpResult(await client.getRunStatus(dagRunId.value));
  },
  dag_runs_result: async (args, client) => {
    const dagRunId = requireString(args, 'dagRunId');
    if (!dagRunId.ok) return usageError(dagRunId.detail);
    return toMcpResult(await client.getRunResult(dagRunId.value));
  },
  dag_run_drafts_create: async (args, client) => {
    const draft = requireObject(args, 'draft');
    if (!draft.ok) return usageError(draft.detail);
    return toMcpResult(
      await client.createRunDraft(draft.value as object as TDagOrchestrationCreateRunDraftRequest),
    );
  },
  dag_run_drafts_get: async (args, client) => {
    const draftId = requireString(args, 'draftId');
    if (!draftId.ok) return usageError(draftId.detail);
    return toMcpResult(await client.getRunDraft(draftId.value));
  },
  dag_run_drafts_replace: async (args, client) => {
    const draftId = requireString(args, 'draftId');
    if (!draftId.ok) return usageError(draftId.detail);
    const draft = requireObject(args, 'draft');
    if (!draft.ok) return usageError(draft.detail);
    return toMcpResult(
      await client.replaceRunDraft(
        draftId.value,
        draft.value as object as TDagOrchestrationReplaceRunDraftRequest,
      ),
    );
  },
  dag_run_drafts_reset_node_result: async (args, client) => {
    const ids = requireDraftNodeIds(args);
    if (!ids.ok) return usageError(ids.detail);
    return toMcpResult(await client.resetRunDraftNodeResult(ids.draftId, ids.nodeId));
  },
  dag_run_drafts_overwrite_node_result: async (args, client) => {
    const ids = requireDraftNodeIds(args);
    if (!ids.ok) return usageError(ids.detail);
    const result = requireObject(args, 'result');
    if (!result.ok) return usageError(result.detail);
    return toMcpResult(
      await client.overwriteRunDraftNodeResult(
        ids.draftId,
        ids.nodeId,
        result.value as object as IDagOrchestrationOverwriteRunDraftNodeResultRequest,
      ),
    );
  },
  dag_workflows_start_run: async (args, client) => {
    const dagId = requireString(args, 'dagId');
    if (!dagId.ok) return usageError(dagId.detail);
    const request = optionalObject(args, 'request');
    const version = optionalNumber(args, 'version');
    return toMcpResult(
      await client.startPublishedWorkflowRun(
        dagId.value,
        request as object as IDagOrchestrationPublishedWorkflowRunRequest | undefined,
        version,
      ),
    );
  },
};

function requireDraftNodeIds(
  args: TToolArgs,
):
  | { readonly ok: true; readonly draftId: string; readonly nodeId: string }
  | { readonly ok: false; readonly detail: string } {
  const draftId = requireString(args, 'draftId');
  if (!draftId.ok) return draftId;
  const nodeId = requireString(args, 'nodeId');
  if (!nodeId.ok) return nodeId;
  return { ok: true, draftId: draftId.value, nodeId: nodeId.value };
}
