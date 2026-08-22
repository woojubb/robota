/**
 * SELFHOST-008 P1 — the authority-backed workspace adapter for the memory port.
 *
 * `WorkspaceMemoryStore` implements `IMemoryStore` by composing the authority-backed
 * mechanisms — `ProjectMemoryStore` (durable read/write through the named `memory` state facet),
 * `MemoryRetrievalService` (budgeted keyword recall), and `PendingMemoryStore` (curation queue). It
 * adds NO authority and no ambient fallback — it is purely the port face over the three existing
 * classes, and absence of a facet means project memory remains unavailable.
 */

import { MemoryRetrievalService } from './memory-retrieval-service.js';
import { PendingMemoryStore } from './pending-memory-store.js';
import { ProjectMemoryStore } from './project-memory-store.js';

import type {
  IMemoryBudget,
  IMemoryStore,
  IAppendMemoryInput,
  IAppendMemoryResult,
  IMemoryCandidate,
  IMemoryPendingRecord,
  IMemoryRetrievalResult,
  IProjectMemorySummary,
  IStartupMemory,
  TMemoryCandidateStatus,
} from './types.js';
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

export class WorkspaceMemoryStore implements IMemoryStore {
  private readonly project: ProjectMemoryStore;
  private readonly pending: PendingMemoryStore;
  private readonly retrieval: MemoryRetrievalService;

  constructor(storage: IWorkspaceProjectStateStorage, now: () => Date = () => new Date()) {
    this.project = new ProjectMemoryStore(storage, now);
    this.pending = new PendingMemoryStore(storage, now);
    // P1R: reuse the SAME project store (honors the injected clock) for the recall read path —
    // one ProjectMemoryStore per cwd, not two.
    this.retrieval = new MemoryRetrievalService(this.project);
  }

  // The methods are async to satisfy the async `IMemoryStore` port; the underlying fs work is
  // synchronous, so each returns an already-resolved value — zero behavior change vs the sync P1 adapter.

  // ── durable project memory ─────────────────────────────────────────────
  async loadStartupMemory(): Promise<IStartupMemory> {
    return this.project.loadStartupMemory();
  }

  async list(): Promise<IProjectMemorySummary> {
    return this.project.list();
  }

  async readTopic(topic: string): Promise<string> {
    return this.project.readTopic(topic);
  }

  async append(input: IAppendMemoryInput): Promise<IAppendMemoryResult> {
    return this.project.append(input);
  }

  // ── budgeted recall ────────────────────────────────────────────────────
  async recall(query: string, budget: IMemoryBudget): Promise<IMemoryRetrievalResult> {
    return this.retrieval.retrieve(query, budget);
  }

  // ── curation queue ─────────────────────────────────────────────────────
  async getPending(id: string): Promise<IMemoryPendingRecord | undefined> {
    return this.pending.get(id);
  }

  async listPending(status?: TMemoryCandidateStatus): Promise<IMemoryPendingRecord[]> {
    return this.pending.list(status);
  }

  async markPending(
    id: string,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<IMemoryPendingRecord> {
    return this.pending.mark(id, status, reason);
  }

  async upsertPending(
    candidate: IMemoryCandidate,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<void> {
    this.pending.upsert(candidate, status, reason);
  }
}

/** Create the memory port adapter for an accepted workspace `memory` state facet. */
export function createWorkspaceMemoryStore(
  storage: IWorkspaceProjectStateStorage,
  now?: () => Date,
): IMemoryStore {
  return new WorkspaceMemoryStore(storage, now);
}
