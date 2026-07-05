/** Handlers for template MCP tools: dag_templates_list, dag_build_from_template */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TEMPLATE_REGISTRY, buildPipelineFromTemplate } from '../../templates/dag-templates.js';
import type { TTemplateSlots } from '../../templates/dag-templates.js';
import { buildDagFromPipeline } from '@robota-sdk/dag-builder';
import type { ILocalMcpServerContext } from '../context.js';
import { makeTextResult, makeErrorResult, validateDagDefinition } from '../utils.js';

export function handleDagTemplatesList(): CallToolResult {
  return makeTextResult({
    templates: TEMPLATE_REGISTRY.map((t) => ({
      id: t.id,
      description: t.description,
      topology: t.topology,
      slots: t.slots.map((s) => ({ name: s.name, type: s.type, required: s.required })),
    })),
  });
}

export function handleDagBuildFromTemplate(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): CallToolResult {
  const templateId = args['templateId'];
  if (typeof templateId !== 'string' || templateId.trim().length === 0) {
    return makeErrorResult('"templateId" is required');
  }
  const slots = args['slots'];
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots)) {
    return makeErrorResult('"slots" must be an object');
  }
  const dagId = typeof args['dagId'] === 'string' ? args['dagId'] : undefined;

  const templateResult = buildPipelineFromTemplate(
    templateId.trim(),
    slots as TTemplateSlots,
    dagId,
  );
  if (!templateResult.ok) {
    return makeTextResult({ ok: false, error: templateResult.error }, true);
  }

  const manifests = ctx.getManifests();
  const buildResult = buildDagFromPipeline(templateResult.buildInput, manifests);
  if (!buildResult.ok) {
    return makeTextResult(
      { ok: false, error: buildResult.error, warnings: buildResult.warnings },
      true,
    );
  }

  const validationErrors = validateDagDefinition(buildResult.definition, manifests);
  return makeTextResult({
    ok: true,
    templateId: templateId.trim(),
    definition: buildResult.definition,
    valid: validationErrors.length === 0,
    validationErrors,
    warnings: buildResult.warnings,
    nodeCount: buildResult.nodeCount,
    edgeCount: buildResult.edgeCount,
  });
}
