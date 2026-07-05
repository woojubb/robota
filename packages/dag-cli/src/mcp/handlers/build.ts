/** Handlers for build-related MCP tools: dag_validate, dag_build */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  buildDagFromPipeline,
  toDagWorkflowFile,
  type IDagBuildInput,
} from '@robota-sdk/dag-builder';
import type { ILocalMcpServerContext } from '../context.js';
import {
  makeTextResult,
  makeErrorResult,
  parseDefinitionArg,
  validateDagDefinition,
} from '../utils.js';

export function handleDagValidate(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): CallToolResult {
  const defResult = parseDefinitionArg(args, 'definition');
  if (!defResult.ok) return makeErrorResult(defResult.error);

  const manifests = ctx.getManifests();
  const errors = validateDagDefinition(defResult.value, manifests);

  return makeTextResult({ valid: errors.length === 0, errors });
}

export function handleDagBuild(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
  sessionGate: import('../../session/session-gate.js').SessionPermissionGate | undefined,
): CallToolResult {
  if (sessionGate) {
    const expiry = sessionGate.checkExpiry();
    if (expiry) return makeTextResult({ ok: false, error: expiry }, true);
  }

  const pipeline = args['pipeline'];
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return makeErrorResult('"pipeline" must be a non-empty array');
  }

  if (sessionGate) {
    const nodeTypes = (pipeline as Array<{ nodeType?: unknown }>)
      .map((n) => (typeof n.nodeType === 'string' ? n.nodeType : ''))
      .filter(Boolean);
    const manifests = ctx.getManifests();
    const violation = sessionGate.checkNodeTypes(
      nodeTypes,
      manifests.map((m) => m.nodeType),
    );
    if (violation) return makeTextResult({ ok: false, error: violation }, true);
  }

  const dagId = typeof args['dagId'] === 'string' ? args['dagId'] : undefined;
  const buildInput: IDagBuildInput = {
    dagId,
    pipeline: pipeline as IDagBuildInput['pipeline'],
  };

  const manifests = ctx.getManifests();
  const buildResult = buildDagFromPipeline(buildInput, manifests);

  if (!buildResult.ok) {
    return makeTextResult(
      { ok: false, error: buildResult.error, warnings: buildResult.warnings },
      true,
    );
  }

  const validationErrors = validateDagDefinition(buildResult.definition, manifests);
  const { workflowFile, companion } = toDagWorkflowFile(buildResult.definition);
  return makeTextResult({
    ok: true,
    definition: buildResult.definition,
    workflowFile,
    companion,
    valid: validationErrors.length === 0,
    validationErrors,
    warnings: buildResult.warnings,
    nodeCount: buildResult.nodeCount,
    edgeCount: buildResult.edgeCount,
  });
}
