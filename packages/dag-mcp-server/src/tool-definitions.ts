import type { IDagMcpToolDefinition } from './types.js';

type TDagMcpInputSchema = IDagMcpToolDefinition['inputSchema'];

const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  properties: {},
} satisfies TDagMcpInputSchema;

export const DAG_MCP_TOOL_DEFINITIONS: readonly IDagMcpToolDefinition[] = [
  {
    name: 'dag_definitions_list',
    description: 'List DAG definitions, optionally filtered by dagId.',
    inputSchema: objectSchema({
      dagId: { type: 'string', description: 'Optional DAG id filter.' },
    }),
  },
  {
    name: 'dag_definitions_get',
    description: 'Get a DAG definition by dagId and optional version.',
    inputSchema: objectSchema(
      {
        dagId: { type: 'string' },
        version: { type: 'number' },
      },
      ['dagId'],
    ),
  },
  {
    name: 'dag_definitions_create',
    description: 'Create a DAG definition draft.',
    inputSchema: objectSchema({ definition: { type: 'object' } }, ['definition']),
  },
  {
    name: 'dag_definitions_update_draft',
    description: 'Update an existing DAG definition draft.',
    inputSchema: objectSchema(
      {
        dagId: { type: 'string' },
        version: { type: 'number' },
        definition: { type: 'object' },
      },
      ['dagId', 'version', 'definition'],
    ),
  },
  {
    name: 'dag_definitions_validate',
    description: 'Validate a DAG definition draft.',
    inputSchema: objectSchema(
      {
        dagId: { type: 'string' },
        version: { type: 'number' },
      },
      ['dagId', 'version'],
    ),
  },
  {
    name: 'dag_definitions_publish',
    description: 'Publish a DAG definition.',
    inputSchema: objectSchema(
      {
        dagId: { type: 'string' },
        version: { type: 'number' },
      },
      ['dagId'],
    ),
  },
  {
    name: 'dag_nodes_list',
    description: 'List runtime node catalog object_info.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
  },
  {
    name: 'dag_assets_upload',
    description: 'Upload an asset from a JSON base64 payload.',
    inputSchema: objectSchema({ asset: { type: 'object' } }, ['asset']),
  },
  {
    name: 'dag_assets_get_metadata',
    description: 'Get asset metadata.',
    inputSchema: objectSchema({ assetId: { type: 'string' } }, ['assetId']),
  },
  {
    name: 'dag_assets_get_content_info',
    description: 'Get binary asset content download information.',
    inputSchema: objectSchema({ assetId: { type: 'string' } }, ['assetId']),
  },
  {
    name: 'dag_runs_create',
    description: 'Create a DAG run preparation from a definition.',
    inputSchema: objectSchema(
      {
        definition: { type: 'object' },
        input: { type: 'object' },
        partialStartNodeId: { type: 'string' },
      },
      ['definition'],
    ),
  },
  {
    name: 'dag_runs_start',
    description: 'Start a prepared DAG run.',
    inputSchema: objectSchema({ preparationId: { type: 'string' } }, ['preparationId']),
  },
  {
    name: 'dag_runs_status',
    description: 'Get DAG run status.',
    inputSchema: objectSchema({ dagRunId: { type: 'string' } }, ['dagRunId']),
  },
  {
    name: 'dag_runs_result',
    description: 'Get DAG run result.',
    inputSchema: objectSchema({ dagRunId: { type: 'string' } }, ['dagRunId']),
  },
  {
    name: 'dag_run_drafts_create',
    description: 'Create or replace an execution run draft.',
    inputSchema: objectSchema({ draft: { type: 'object' } }, ['draft']),
  },
  {
    name: 'dag_run_drafts_get',
    description: 'Get an execution run draft.',
    inputSchema: objectSchema({ draftId: { type: 'string' } }, ['draftId']),
  },
  {
    name: 'dag_run_drafts_replace',
    description: 'Replace an execution run draft.',
    inputSchema: objectSchema(
      {
        draftId: { type: 'string' },
        draft: { type: 'object' },
      },
      ['draftId', 'draft'],
    ),
  },
  {
    name: 'dag_run_drafts_reset_node_result',
    description: 'Reset one run draft node result and downstream results.',
    inputSchema: objectSchema(
      {
        draftId: { type: 'string' },
        nodeId: { type: 'string' },
      },
      ['draftId', 'nodeId'],
    ),
  },
  {
    name: 'dag_run_drafts_overwrite_node_result',
    description: 'Manually overwrite one run draft node result.',
    inputSchema: objectSchema(
      {
        draftId: { type: 'string' },
        nodeId: { type: 'string' },
        result: { type: 'object' },
      },
      ['draftId', 'nodeId', 'result'],
    ),
  },
  {
    name: 'dag_workflows_start_run',
    description: 'Start a published workflow run.',
    inputSchema: objectSchema(
      {
        dagId: { type: 'string' },
        version: { type: 'number' },
        request: { type: 'object' },
      },
      ['dagId'],
    ),
  },
];

function objectSchema(
  properties: Record<string, object>,
  required: readonly string[] = [],
): TDagMcpInputSchema {
  return required.length > 0
    ? { type: 'object', properties, required: [...required] }
    : { type: 'object', properties };
}
