import type { IDagDefinition, IPartialRunRequest, TPortPayload } from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationHttpClient,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  IDagOrchestrationPublishedWorkflowRunRequest,
  TDagOrchestrationCreateRunDraftRequest,
  TDagOrchestrationReplaceRunDraftRequest,
} from '@robota-sdk/dag-orchestration-client';
import type {
  IDagMcpToolCallResult,
  IDagMcpToolDefinition,
  IDagMcpUsageErrorPayload,
} from './types.js';
import { DAG_MCP_TOOL_DEFINITIONS } from './tool-definitions.js';
type TDagMcpArgumentValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | TToolArgs
  | readonly TDagMcpArgumentValue[];
interface TToolArgs {
  readonly [key: string]: TDagMcpArgumentValue;
}
type TToolHandler = (
  args: TToolArgs,
  client: IDagOrchestrationHttpClient,
) => Promise<IDagMcpToolCallResult>;

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

function toMcpResult(response: {
  readonly ok: boolean;
  readonly payload: object;
}): IDagMcpToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(response.payload, null, 2) }],
    isError: !response.ok,
  };
}

function usageError(detail: string): IDagMcpToolCallResult {
  const payload: IDagMcpUsageErrorPayload = {
    ok: false,
    status: 2,
    errors: [
      {
        type: 'urn:robota:problems:dag:mcp_usage',
        title: 'Invalid MCP tool arguments',
        status: 2,
        detail,
        instance: 'mcp://dag',
        code: 'DAG_MCP_USAGE_ERROR',
        retryable: false,
      },
    ],
  };
  return {
    content: [{ type: 'text', text: `Error: ${detail}\n${JSON.stringify(payload, null, 2)}` }],
    isError: true,
  };
}

function toToolArgs(args: object | null | undefined): TToolArgs {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as TToolArgs)
    : {};
}

function requireString(
  args: TToolArgs,
  key: string,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly detail: string } {
  const value = args[key];
  if (typeof value === 'string' && value.trim().length > 0) return { ok: true, value };
  return { ok: false, detail: `${key} is required` };
}

function optionalString(args: TToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function requireNumber(
  args: TToolArgs,
  key: string,
): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly detail: string } {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, value };
  return { ok: false, detail: `${key} is required` };
}

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

function optionalNumber(args: TToolArgs, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireObject(
  args: TToolArgs,
  key: string,
):
  | { readonly ok: true; readonly value: TToolArgs }
  | { readonly ok: false; readonly detail: string } {
  const value = args[key];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { ok: true, value: value as TToolArgs };
  }
  return { ok: false, detail: `${key} is required` };
}

function optionalObject(args: TToolArgs, key: string): TToolArgs | undefined {
  const value = args[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as TToolArgs)
    : undefined;
}
