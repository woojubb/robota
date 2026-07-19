/**
 * SELFHOST-008 P1 — the neutral filesystem reference adapter for the memory port.
 *
 * `FileSystemMemoryStore` implements `IMemoryStore` by composing the existing, unchanged neutral
 * mechanisms — `ProjectMemoryStore` (durable write/read under `<cwd>/.robota/memory/`),
 * `MemoryRetrievalService` (budgeted keyword recall), and `PendingMemoryStore` (curation queue). It
 * mirrors `InMemorySandboxClient` (the sandbox precedent's reference adapter that lives in the same
 * package as its port): the default store when no adapter is injected, so memory keeps working exactly
 * as today. It adds NO new behavior — it is purely the port face over the three existing classes.
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

export class FileSystemMemoryStore implements IMemoryStore {
  private readonly project: ProjectMemoryStore;
  private readonly pending: PendingMemoryStore;
  private readonly retrieval: MemoryRetrievalService;

  constructor(cwd: string, now: () => Date = () => new Date()) {
    this.project = new ProjectMemoryStore(cwd, now);
    this.pending = new PendingMemoryStore(cwd, now);
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

/** Create the neutral filesystem reference memory store for a workspace. */
export function createFileSystemMemoryStore(cwd: string, now?: () => Date): IMemoryStore {
  return new FileSystemMemoryStore(cwd, now);
}
