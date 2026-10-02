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
import { ProjectMemoryStore, sanitizeTopic } from './project-memory-store.js';

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

  async replaceTopic(input: IAppendMemoryInput) {
    const result = this.project.replaceTopic(input);
    this.purgePendingTopic(result.topic);
    return result;
  }

  async forgetTopic(topic: string) {
    const result = this.project.forgetTopic(topic);
    this.purgePendingTopic(result.topic);
    return result;
  }

  private purgePendingTopic(topic: string): void {
    for (const record of this.pending.list()) {
      if (sanitizeTopic(record.topic) === topic) {
        this.pending.upsert(record, 'skipped', 'user-curated-topic');
      }
    }
  }

  // ── budgeted recall ────────────────────────────────────────────────────
  async recall(query: string, budget: IMemoryBudget): Promise<IMemoryRetrievalResult> {
    return this.retrieval.retrieve(query, budget);
  }

  // ── curation queue ─────────────────────────────────────────────────────
  async getPending(id: string): Promise<IMemoryPendingRecord | undefined> {
    const record = this.pending.get(id);
    return record && !this.project.isTopicCurated(record.topic) ? record : undefined;
  }

  async listPending(status?: TMemoryCandidateStatus): Promise<IMemoryPendingRecord[]> {
    return this.pending.list(status).filter((record) => !this.project.isTopicCurated(record.topic));
  }

  async markPending(
    id: string,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<IMemoryPendingRecord> {
    const record = this.pending.get(id);
    if (record && this.project.isTopicCurated(record.topic))
      throw new Error(
        'This memory topic is controlled by the user; use /memory correct to change it.',
      );
    return this.pending.mark(id, status, reason);
  }

  async upsertPending(
    candidate: IMemoryCandidate,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<void> {
    if (this.project.isTopicCurated(candidate.topic)) {
      this.pending.upsert(candidate, 'skipped', 'user-curated-topic');
      return;
    }
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
