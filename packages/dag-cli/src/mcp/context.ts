/** ILocalMcpServerContext: shared mutable state and accessors for MCP tool handlers. */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IDagNodeDefinition, INodeManifest } from '@robota-sdk/dag-core';
import {
  createPromptBackedNodeDefinition,
  type ICreatePromptNodeInput,
} from '@robota-sdk/dag-node-instant-node';
import { createCliNodeRegistry } from '../local-runner/index.js';
import type { IMcpCommandOptions, IRunRecord } from './types.js';
import { buildManifests } from './utils.js';
import { getRunStore } from '../run-store.js';
import type { IRunStoreListOptions } from '../run-store.js';

export interface IActiveProviderInfo {
  providerId: string;
}

export interface ILocalMcpServerContext {
  // Shared state accessors
  getAllDefinitions(): ReturnType<typeof createCliNodeRegistry>;
  getManifests(): INodeManifest[];
  invalidateNodeCache(): void;
  addCompletedRun(record: IRunRecord): void;
  getCompletedRun(runId: string): IRunRecord | undefined;
  listCompletedRuns(opts?: IRunStoreListOptions): IRunRecord[];
  // Provider selection (PROVIDER-008)
  getActiveProvider(): IActiveProviderInfo;
  setActiveProvider(info: IActiveProviderInfo): void;
  // Instant nodes (mutable)
  instantNodeDefinitions: IDagNodeDefinition[];
  // Options
  options: IMcpCommandOptions;
}

const MAX_COMPLETED_RUNS = 500;
const COMPLETED_RUN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createMcpServerContext(options: IMcpCommandOptions): ILocalMcpServerContext {
  // Ephemeral instant node registry — cleared on process restart
  const instantNodeDefinitions: IDagNodeDefinition[] = [];

  // Load persisted instant nodes on startup using createPromptBackedNodeDefinition (non-blocking)
  async function loadPersistedInstantNodes(): Promise<void> {
    const nodesDir = join(options.projectDir ?? process.cwd(), '.dag', 'nodes');
    let files: string[];
    try {
      files = await readdir(nodesDir);
    } catch {
      // allow-fallback: .dag/nodes/ doesn't exist yet; no nodes to load
      return;
    }
    for (const file of files.filter((f) => f.endsWith('.instant-node.json'))) {
      try {
        const raw = await readFile(join(nodesDir, file), 'utf-8');
        const record = JSON.parse(raw) as Record<string, unknown>;

        // Skip composite nodes (taskCode === null) — cannot be reconstructed without inner DAG runner
        if (typeof record['taskCode'] !== 'string') continue;
        // Skip if nodeType is missing
        if (typeof record['nodeType'] !== 'string') continue;

        // Skip if nodeType already registered (session-created nodes take priority)
        if (instantNodeDefinitions.some((n) => n.nodeType === record['nodeType'])) continue;

        const spec: ICreatePromptNodeInput = {
          nodeType: record['nodeType'] as string,
          displayName:
            typeof record['displayName'] === 'string'
              ? record['displayName']
              : (record['nodeType'] as string),
          systemPromptTemplate: record['taskCode'] as string,
          inputPorts:
            Array.isArray(record['inputs']) && (record['inputs'] as unknown[]).length > 0
              ? (record['inputs'] as Array<{ key: string }>).map((p) => ({ key: p.key }))
              : [{ key: 'text' }],
          outputPort:
            Array.isArray(record['outputs']) && (record['outputs'] as unknown[]).length > 0
              ? { key: (record['outputs'] as Array<{ key: string }>)[0].key }
              : { key: 'text' },
        };
        const nodeDef: IDagNodeDefinition = createPromptBackedNodeDefinition(spec);
        instantNodeDefinitions.push(nodeDef);
      } catch {
        // allow-fallback: individual unreadable/malformed file is skipped
        continue;
      }
    }
  }

  void loadPersistedInstantNodes();

  // Completed run registry — enables dag_runs_poll_progress after dag_run_definition
  const completedRuns = new Map<string, IRunRecord>();

  // Node definitions and manifests are rebuilt once and cached; invalidated only on instant-node mutation.
  let cachedDefinitions: ReturnType<typeof createCliNodeRegistry> | null = null;
  let cachedManifests: INodeManifest[] | null = null;

  function invalidateNodeCache(): void {
    cachedDefinitions = null;
    cachedManifests = null;
  }

  function getAllDefinitions(): ReturnType<typeof createCliNodeRegistry> {
    if (!cachedDefinitions) {
      cachedDefinitions = [...createCliNodeRegistry(), ...instantNodeDefinitions];
    }
    return cachedDefinitions;
  }

  function getManifests(): INodeManifest[] {
    if (!cachedManifests) {
      cachedManifests = buildManifests(getAllDefinitions());
    }
    return cachedManifests;
  }

  function addCompletedRun(record: IRunRecord): void {
    // Evict expired entries first
    const expiredBefore = Date.now() - COMPLETED_RUN_TTL_MS;
    for (const [id, r] of completedRuns) {
      if (r.completedAt < expiredBefore) completedRuns.delete(id);
    }
    // Evict oldest entries if over capacity
    if (completedRuns.size >= MAX_COMPLETED_RUNS) {
      const oldestKey = completedRuns.keys().next().value;
      if (oldestKey !== undefined) completedRuns.delete(oldestKey);
    }
    completedRuns.set(record.dagRunId, record);

    // Persist to SQLite for cross-session history (non-fatal)
    try {
      getRunStore(options.projectDir ?? process.cwd()).insert({
        runId: record.dagRunId,
        dagId: record.dagId ?? '',
        status: record.status,
        completedAt: record.completedAt,
        durationMs: record.durationMs,
      });
    } catch {
      // allow-fallback: SQLite write failure is non-fatal; in-memory record still stored
    }
  }

  function getCompletedRun(runId: string): IRunRecord | undefined {
    return completedRuns.get(runId);
  }

  function listCompletedRuns(opts?: IRunStoreListOptions): IRunRecord[] {
    try {
      return getRunStore(options.projectDir ?? process.cwd())
        .list(opts)
        .map((r) => ({
          dagRunId: r.runId,
          dagId: r.dagId,
          status: r.status,
          completedAt: r.completedAt,
          durationMs: r.durationMs,
          nodeStatuses: [],
        }));
    } catch {
      // allow-fallback: SQLite unavailable returns empty list
      return [];
    }
  }

  let activeProvider: IActiveProviderInfo = {
    providerId: process.env['DAG_DEFAULT_PROVIDER'] ?? 'local',
  };

  function getActiveProvider(): IActiveProviderInfo {
    return activeProvider;
  }

  function setActiveProvider(info: IActiveProviderInfo): void {
    activeProvider = info;
  }

  return {
    getAllDefinitions,
    getManifests,
    invalidateNodeCache,
    addCompletedRun,
    getCompletedRun,
    listCompletedRuns,
    getActiveProvider,
    setActiveProvider,
    instantNodeDefinitions,
    options,
  };
}
