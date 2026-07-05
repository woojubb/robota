/**
 * Reconstructs prompt-backed nodes previously saved under `<root>/nodes/*.node.json` so authored
 * workflows that reference them can run, and so a later `create` can reuse them. Mirrors the on-disk
 * format written by `saveInstantNodeFile` and read by the shared catalog reader.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DEFAULT_WORKSPACE_LAYOUT, type IWorkspaceLayout } from '@robota-sdk/dag-core';
import type { IDagNodeDefinition } from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  type TInstantNodeProvider,
} from '@robota-sdk/dag-node-instant-node';

const NODE_MANIFEST_EXT = '.node.json';
const PROVIDERS: readonly TInstantNodeProvider[] = [
  'anthropic',
  'openai',
  'gemini',
  'deepseek',
  'qwen',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parsePorts(value: unknown): Array<{ key: string; description?: string }> | null {
  if (!Array.isArray(value)) return null;
  const ports: Array<{ key: string; description?: string }> = [];
  for (const raw of value) {
    const r = asRecord(raw);
    if (!r || typeof r['key'] !== 'string') return null;
    ports.push({ key: r['key'] });
  }
  return ports.length > 0 ? ports : null;
}

function toProvider(value: unknown): TInstantNodeProvider | undefined {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value)
    ? (value as TInstantNodeProvider)
    : undefined;
}

/** Reconstruct a single prompt-backed node from a persisted `kind: 'prompt'` record, or null. */
function reconstructPromptNode(raw: unknown): IDagNodeDefinition | null {
  const r = asRecord(raw);
  if (!r || r['kind'] !== 'prompt' || typeof r['nodeType'] !== 'string') return null;
  if (typeof r['systemPromptTemplate'] !== 'string') return null;
  const inputPorts = parsePorts(r['inputPorts']);
  const outputRec = asRecord(r['outputPort']);
  if (!inputPorts || !outputRec || typeof outputRec['key'] !== 'string') return null;
  const provider = toProvider(r['provider']);
  return createPromptBackedNodeDefinition({
    nodeType: r['nodeType'],
    displayName: typeof r['displayName'] === 'string' ? r['displayName'] : r['nodeType'],
    systemPromptTemplate: r['systemPromptTemplate'],
    inputPorts,
    outputPort: { key: outputRec['key'] },
    ...(provider ? { provider } : {}),
    ...(typeof r['model'] === 'string' ? { model: r['model'] } : {}),
  });
}

/**
 * Load all reconstructable prompt-backed nodes from `<cwd>/<root>/nodes/`. Missing dir → empty list;
 * unparseable/unsupported manifests are skipped (never throws).
 */
export async function loadInstantNodes(
  cwd: string,
  layout: IWorkspaceLayout = DEFAULT_WORKSPACE_LAYOUT,
): Promise<IDagNodeDefinition[]> {
  const dir = resolve(cwd, join(layout.root, 'nodes'));
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // allow-fallback: nodes dir may not exist yet → no local nodes
    return [];
  }
  const nodes: IDagNodeDefinition[] = [];
  for (const file of files.filter((f) => f.endsWith(NODE_MANIFEST_EXT))) {
    try {
      const parsed = JSON.parse(await readFile(join(dir, file), 'utf-8')) as unknown;
      const node = reconstructPromptNode(parsed);
      if (node) nodes.push(node);
    } catch {
      // allow-fallback: unreadable/unparseable manifest skipped
      continue;
    }
  }
  return nodes;
}
