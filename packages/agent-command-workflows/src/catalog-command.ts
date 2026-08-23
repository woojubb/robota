import { join } from 'node:path';

import {
  DEFAULT_WORKSPACE_LAYOUT,
  type IDagDefinition,
  type IWorkspaceLayout,
} from '@robota-sdk/dag-core';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import { assertWorkflowProject } from './workflow-project.js';

import type { IWorkflowProject } from './workflow-project.js';

interface IWorkflowCatalogEntry {
  readonly id: string;
  readonly definition: IDagDefinition;
}

function isDagShaped(value: unknown): value is IDagDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record['nodes']) || typeof record['dagId'] === 'string';
}

function readWorkflowCatalog(
  project: IWorkflowProject,
  layout: IWorkspaceLayout,
): IWorkflowCatalogEntry[] {
  const accepted = assertWorkflowProject(project);
  const entries: IWorkflowCatalogEntry[] = [];
  for (const entry of accepted.listDirectory(layout.root, 'discover workflow catalog')) {
    if (
      entry.kind !== 'file' ||
      entry.name.endsWith('.node.json') ||
      !entry.name.endsWith(layout.workflowExt)
    ) {
      continue;
    }
    try {
      const raw = accepted.readText(join(layout.root, entry.name), 'load workflow catalog entry');
      if (raw === undefined) continue;
      const definition = JSON.parse(raw) as unknown;
      if (!isDagShaped(definition)) continue;
      entries.push({
        id: entry.name.slice(0, -layout.workflowExt.length),
        definition,
      });
    } catch {
      // allow-fallback: malformed catalog entries are omitted from discovery.
    }
  }
  return entries.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * `/workflows catalog` — list the workflow definitions flat under the injected workspace root (default
 * `.workflows/`, `<name>.json`) via the shared `scanWorkspaceCatalog` reader (FLOW-007 C3 — one reader
 * across dag-cli's `catalog` and this command). Node manifests + non-DAG JSON are skipped.
 */
export async function executeWorkflowsCatalog(
  project: IWorkflowProject,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<ICommandResult> {
  const dir = layout.root;
  const ext = layout.workflowExt;
  const entries = readWorkflowCatalog(project, layout);
  if (entries.length === 0) {
    return { success: true, message: `No workflow files (*${ext}) in ${dir}.` };
  }
  const lines = entries.map((e) => {
    const raw = e.definition as unknown as {
      nodes?: unknown[];
      edges?: unknown[];
      links?: unknown[];
    };
    const nodeCount = raw.nodes?.length ?? 0;
    const linkCount = raw.edges?.length ?? raw.links?.length ?? 0;
    return `  ${e.id}${ext} — ${nodeCount} node(s), ${linkCount} link(s)`;
  });
  return {
    success: true,
    message: `Workflows in ${dir} (${entries.length}):\n${lines.join('\n')}`,
  };
}
