/** Handlers for catalog MCP tools: dag_catalog_list, dag_catalog_search, dag_catalog_run */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TPortPayload } from '@robota-sdk/dag-core';
import {
  scanCatalogDir,
  resolveCatalogDirs,
  matchesCatalogQuery,
} from '../../catalog/catalog-scanner.js';
import type { ICatalogEntry } from '../../catalog/catalog-scanner.js';
import type { ILocalMcpServerContext } from '../context.js';
import { makeTextResult, makeErrorResult, DEFAULT_TIMEOUT_MS } from '../utils.js';
import { runDagDefinition } from './runs.js';

async function collectCatalogEntries(
  catalogDir: string | undefined,
  optionsCatalogDir: string | undefined,
): Promise<ICatalogEntry[]> {
  const dirs = resolveCatalogDirs({ catalogDir: catalogDir ?? optionsCatalogDir });
  const allEntries: ICatalogEntry[] = [];
  for (const dir of dirs) {
    const entries = await scanCatalogDir(dir);
    for (const entry of entries) {
      if (!allEntries.some((e) => e.id === entry.id)) {
        allEntries.push(entry);
      }
    }
  }
  allEntries.sort((a, b) => a.id.localeCompare(b.id));
  return allEntries;
}

export async function handleDagCatalogList(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const catalogDir = typeof args['catalogDir'] === 'string' ? args['catalogDir'] : undefined;
  const allEntries = await collectCatalogEntries(catalogDir, ctx.options.catalogDir);

  return makeTextResult({
    workflows: allEntries.map((e) => ({
      id: e.id,
      filePath: e.filePath,
      description: e.meta.description,
      tags: e.meta.tags,
      nodeCount: e.definition.nodes?.length ?? 0,
    })),
  });
}

export async function handleDagCatalogSearch(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const catalogDir = typeof args['catalogDir'] === 'string' ? args['catalogDir'] : undefined;
  const allEntries = await collectCatalogEntries(catalogDir, ctx.options.catalogDir);

  const query = args['query'];
  if (typeof query !== 'string' || query.trim().length === 0) {
    return makeErrorResult('"query" is required');
  }
  const matches = allEntries.filter((e) => matchesCatalogQuery(e, query));
  return makeTextResult({
    query,
    matches: matches.map((e) => ({
      id: e.id,
      filePath: e.filePath,
      description: e.meta.description,
      tags: e.meta.tags,
      nodeCount: e.definition.nodes?.length ?? 0,
    })),
  });
}

export async function handleDagCatalogRun(
  ctx: ILocalMcpServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const id = args['id'];
  if (typeof id !== 'string' || id.trim().length === 0) {
    return makeErrorResult('"id" is required');
  }

  const catalogDir = typeof args['catalogDir'] === 'string' ? args['catalogDir'] : undefined;
  const allEntries = await collectCatalogEntries(catalogDir, ctx.options.catalogDir);

  const entry = allEntries.find((e) => e.id === id);
  if (!entry) {
    const similar = allEntries
      .map((e) => e.id)
      .filter((eid) => eid.includes(id) || id.includes(eid))
      .slice(0, 3);
    const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
    return makeErrorResult(`No workflow found with id "${id}".${suggestion}`);
  }

  const inputs = (
    typeof args['inputs'] === 'object' && args['inputs'] !== null ? args['inputs'] : {}
  ) as TPortPayload;
  const timeoutMs =
    typeof args['timeoutMs'] === 'number' && Number.isFinite(args['timeoutMs'])
      ? (args['timeoutMs'] as number)
      : DEFAULT_TIMEOUT_MS;

  return runDagDefinition(
    entry.definition,
    inputs,
    timeoutMs,
    ctx.options.createRunner,
    ctx.instantNodeDefinitions,
  );
}
