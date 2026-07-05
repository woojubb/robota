/** ILocalMcpServerContext: shared mutable state and accessors for MCP tool handlers. */

import type { IDagNodeDefinition, INodeManifest } from '@robota-sdk/dag-core';
import { createCliNodeRegistry } from '../local-runner/index.js';
import { loadSavedInstantNodes } from './handlers/instant-nodes.js';
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

  // Load persisted instant nodes (prompt AND composite — BEHAVIOR-006) on startup via the single
  // shared loader (non-blocking). Composite runners close over `instantNodeDefinitions`.
  async function loadPersistedInstantNodes(): Promise<void> {
    await loadSavedInstantNodes(options.projectDir ?? process.cwd(), instantNodeDefinitions);
    invalidateNodeCache();
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
