/** Handlers for format conversion MCP tools: dag_export, dag_import */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  toDagWorkflowFile,
  fromDagWorkflowFile,
  isWorkflowFileFormat,
  isLegacyDefinitionFormat,
} from '@robota-sdk/dag-builder';
import type { IDagRobotaCompanion } from '@robota-sdk/dag-core';
import { makeTextResult, makeErrorResult, parseDefinitionArg } from '../utils.js';

export function handleDagExport(args: Record<string, unknown>): CallToolResult {
  const defResult = parseDefinitionArg(args, 'definition');
  if (!defResult.ok) return makeErrorResult(defResult.error);

  const { workflowFile, companion } = toDagWorkflowFile(defResult.value);
  return makeTextResult({
    ok: true,
    workflowFile,
    companion,
    note: 'Save workflowFile as <name>.dag.json and companion as <name>.dag.robota.json',
  });
}

export function handleDagImport(args: Record<string, unknown>): CallToolResult {
  const raw = args['workflowFile'];
  if (!isWorkflowFileFormat(raw)) {
    if (isLegacyDefinitionFormat(raw)) {
      return makeTextResult({
        ok: true,
        definition: raw,
        note: 'Input was already in IDagDefinition format — returned as-is.',
      });
    }
    return makeErrorResult(
      '"workflowFile" must be an IDagWorkflowFile object (has nodes[], links[], version fields).',
    );
  }

  const companion =
    typeof args['companion'] === 'object' && args['companion'] !== null
      ? (args['companion'] as IDagRobotaCompanion)
      : undefined;

  const definition = fromDagWorkflowFile(raw, companion);
  return makeTextResult({ ok: true, definition });
}
