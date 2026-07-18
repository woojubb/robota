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
    this.retrieval = new MemoryRetrievalService(cwd);
  }

  // ── durable project memory ─────────────────────────────────────────────
  loadStartupMemory(): IStartupMemory {
    return this.project.loadStartupMemory();
  }

  list(): IProjectMemorySummary {
    return this.project.list();
  }

  readTopic(topic: string): string {
    return this.project.readTopic(topic);
  }

  append(input: IAppendMemoryInput): IAppendMemoryResult {
    return this.project.append(input);
  }

  // ── budgeted recall ────────────────────────────────────────────────────
  recall(query: string, budget: IMemoryBudget): IMemoryRetrievalResult {
    // The keyword recall service takes an IAutomaticMemoryConfig; only its `retrieval` budget is used.
    return this.retrieval.retrieve(query, {
      policy: 'disabled',
      retrieval: { maxTopics: budget.maxTopics, maxTopicChars: budget.maxTopicChars },
    });
  }

  // ── curation queue ─────────────────────────────────────────────────────
  getPending(id: string): IMemoryPendingRecord | undefined {
    return this.pending.get(id);
  }

  listPending(status?: TMemoryCandidateStatus): IMemoryPendingRecord[] {
    return this.pending.list(status);
  }

  markPending(id: string, status: TMemoryCandidateStatus, reason: string): IMemoryPendingRecord {
    return this.pending.mark(id, status, reason);
  }

  upsertPending(candidate: IMemoryCandidate, status: TMemoryCandidateStatus, reason: string): void {
    this.pending.upsert(candidate, status, reason);
  }
}

/** Create the neutral filesystem reference memory store for a workspace. */
export function createFileSystemMemoryStore(cwd: string, now?: () => Date): IMemoryStore {
  return new FileSystemMemoryStore(cwd, now);
}
