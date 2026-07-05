/** createLocalMcpServer: wires the MCP Server with all tool handlers. */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { SessionPermissionGate, parseSessionPermissionsFromEnv } from '../session/session-gate.js';
import type { IMcpCommandOptions } from './types.js';
import { createMcpServerContext } from './context.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';
import { makeErrorResult } from './utils.js';
import {
  handleDagNodesList,
  handleDagNodePackagesList,
  handleDagNodesInfo,
} from './handlers/nodes.js';
import {
  handleDagRunDefinition,
  handleDagRunFile,
  handleDagRunsPollProgress,
  handleDagRunsCancel,
  handleDagRunsList,
} from './handlers/runs.js';
import { handleDagValidate, handleDagBuild } from './handlers/build.js';
import {
  handleDagCatalogList,
  handleDagCatalogSearch,
  handleDagCatalogRun,
} from './handlers/catalog.js';
import {
  handleDagInstantNodeCreate,
  handleDagInstantNodeCreateComposite,
  handleDagInstantNodeList,
  handleInstantNodeSave,
  handleInstantNodeListSaved,
} from './handlers/instant-nodes.js';
import { handleDagTemplatesList, handleDagBuildFromTemplate } from './handlers/templates.js';
import { handleDagExport, handleDagImport } from './handlers/format.js';
import {
  handleDagProviderList,
  handleDagProviderNodes,
  handleDagProviderRefresh,
  handleDagProviderSet,
} from './handlers/providers.js';

/** Create the local MCP server and register all tool handlers. Exported for testing. */
export function createLocalMcpServer(options: IMcpCommandOptions = {}): Server {
  const server = new Server(
    { name: 'robota-dag', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // Optional session permission gate — active when DAG_SESSION_PERMISSIONS env var is set
  const sessionPermissions = parseSessionPermissionsFromEnv();
  const sessionGate = sessionPermissions
    ? new SessionPermissionGate(sessionPermissions)
    : undefined;

  const ctx = createMcpServerContext(options);

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as ListToolsResult['tools'][number]['inputSchema'],
      })),
    }),
  );

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    if (toolName === 'dag_nodes_list') {
      return handleDagNodesList(ctx);
    }

    if (toolName === 'dag_node_packages_list') {
      return handleDagNodePackagesList(ctx, args);
    }

    if (toolName === 'dag_nodes_info') {
      return handleDagNodesInfo(ctx, args);
    }

    if (toolName === 'dag_run_definition') {
      return handleDagRunDefinition(ctx, args, sessionGate);
    }

    if (toolName === 'dag_runs_poll_progress') {
      return handleDagRunsPollProgress(ctx, args);
    }

    if (toolName === 'dag_runs_cancel') {
      return handleDagRunsCancel(ctx, args);
    }

    if (toolName === 'dag_runs_list') {
      return handleDagRunsList(ctx, args);
    }

    if (toolName === 'dag_run_file') {
      return handleDagRunFile(ctx, args);
    }

    if (toolName === 'dag_validate') {
      return handleDagValidate(ctx, args);
    }

    if (toolName === 'dag_build') {
      return handleDagBuild(ctx, args, sessionGate);
    }

    if (toolName === 'dag_catalog_list') {
      return handleDagCatalogList(ctx, args);
    }

    if (toolName === 'dag_catalog_search') {
      return handleDagCatalogSearch(ctx, args);
    }

    if (toolName === 'dag_catalog_run') {
      return handleDagCatalogRun(ctx, args);
    }

    if (toolName === 'dag_instant_node_create') {
      return handleDagInstantNodeCreate(ctx, args, sessionGate);
    }

    if (toolName === 'dag_instant_node_create_composite') {
      return handleDagInstantNodeCreateComposite(ctx, args, sessionGate);
    }

    if (toolName === 'dag_instant_node_list') {
      return handleDagInstantNodeList(ctx);
    }

    if (toolName === 'dag_templates_list') {
      return handleDagTemplatesList();
    }

    if (toolName === 'dag_build_from_template') {
      return handleDagBuildFromTemplate(ctx, args);
    }

    if (toolName === 'dag_export') {
      return handleDagExport(args);
    }

    if (toolName === 'dag_import') {
      return handleDagImport(args);
    }

    if (toolName === 'dag_instant_node_save') {
      return handleInstantNodeSave(args, ctx);
    }

    if (toolName === 'dag_instant_node_list_saved') {
      return handleInstantNodeListSaved(args, ctx);
    }

    if (toolName === 'dag_provider_list') {
      return handleDagProviderList(ctx);
    }

    if (toolName === 'dag_provider_set') {
      return handleDagProviderSet(ctx, args);
    }

    if (toolName === 'dag_provider_nodes') {
      return handleDagProviderNodes(ctx, args);
    }

    if (toolName === 'dag_provider_refresh') {
      return handleDagProviderRefresh(ctx, args);
    }

    if (toolName === 'dag_runs_list') {
      return handleDagRunsList(ctx, args);
    }

    return makeErrorResult(`Unknown tool: ${toolName}`);
  });

  return server;
}
