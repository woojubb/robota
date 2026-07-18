/**
 * SELFHOST-008 P1 — the neutral durable-memory port.
 *
 * `IMemoryStore` is the single DIP seam for the memory capability, mirroring the STRUCTURE of the
 * sandbox precedent (`ISandboxClient` in `@robota-sdk/agent-tools`): the port + its neutral reference
 * adapter live IN the package that owns memory's consumers (session-lifecycle assembly + `/memory`
 * command-api), NOT in `agent-core` and NOT in a new interface package. It unifies what today is split
 * across `ProjectMemoryStore` (durable write/read), `MemoryRetrievalService` (budgeted keyword recall),
 * and `PendingMemoryStore` (curation queue) so a surface can swap the whole store without editing the
 * library.
 *
 * v1 commits to ONE recall backend — the neutral keyword/FTS reference adapter (`FileSystemMemoryStore`).
 * The heavy semantic/vector backend is a SEPARATE, duck-typed, DEFERRED port (`ISemanticMemoryAdapter`,
 * mirroring `IE2BSandboxAdapter`) so no vector-DB SDK becomes an `agent-framework` dependency; the port
 * may be revised when that backend lands (a conscious deferral, not a hidden one).
 *
 * Library-neutrality: this port and its fs reference adapter are neutral MECHANISMS. Memory CONTENT lives
 * only in the consumer workspace (`<cwd>/.robota/memory/`), and curation POLICY/prompt is supplied by the
 * surface — neither belongs in `packages/`.
 */

import type {
  IMemoryCandidate,
  IMemoryPendingRecord,
  IMemoryReference,
  IMemoryRetrievalResult,
  TMemoryCandidateStatus,
} from './automatic-memory-types.js';
import type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IProjectMemorySummary,
  IStartupMemory,
} from './project-memory-store.js';

export type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IProjectMemorySummary,
  IStartupMemory,
  IMemoryCandidate,
  IMemoryPendingRecord,
  IMemoryReference,
  IMemoryRetrievalResult,
  TMemoryCandidateStatus,
};

/** A recall budget: at most `maxTopics` topics, each truncated to `maxTopicChars` characters. */
export interface IMemoryBudget {
  maxTopics: number;
  maxTopicChars: number;
}

/**
 * The neutral durable-memory port. Flat by design (mirrors the flat `ISandboxClient`), with method
 * groups for durable project memory (write + read), budgeted recall, and the curation queue. The v1
 * reference adapter is synchronous (filesystem); a later semantic backend is injected via the separate
 * async `ISemanticMemoryAdapter`, so this port stays sync and is not prematurely Promise-ified.
 */
export interface IMemoryStore {
  // ── durable project memory (write + read) ──────────────────────────────
  /** The startup-memory index (budget-limited), injected into the system prompt. */
  loadStartupMemory(): IStartupMemory;
  /** Summarize the memory index + topic files. */
  list(): IProjectMemorySummary;
  /** Read a single topic's content ('' if absent). */
  readTopic(topic: string): string;
  /** Append a durable memory entry (deduplicated). */
  append(input: IAppendMemoryInput): IAppendMemoryResult;

  // ── budgeted recall ────────────────────────────────────────────────────
  /** Recall the most relevant topics for `query`, never exceeding `budget`. */
  recall(query: string, budget: IMemoryBudget): IMemoryRetrievalResult;

  // ── curation queue ─────────────────────────────────────────────────────
  /** A pending candidate by id (undefined if absent). */
  getPending(id: string): IMemoryPendingRecord | undefined;
  /** Pending candidates, optionally filtered by status. */
  listPending(status?: TMemoryCandidateStatus): IMemoryPendingRecord[];
  /** Transition a pending candidate to a new status with a reason. */
  markPending(id: string, status: TMemoryCandidateStatus, reason: string): IMemoryPendingRecord;
  /** Insert or update a pending candidate with a status + reason. */
  upsertPending(candidate: IMemoryCandidate, status: TMemoryCandidateStatus, reason: string): void;
}

/** A single semantic recall hit (deferred backend). */
export interface ISemanticMemoryQueryResult {
  content: string;
  references: IMemoryReference[];
}

/**
 * DEFERRED (P3) duck-typed port for a heavy semantic/vector memory backend, mirroring the way
 * `E2BSandboxClient` duck-types the E2B SDK via `IE2BSandboxAdapter` — so a concrete vector-DB SDK is
 * NEVER an `agent-framework` dependency. v1 defines the shape only; no library code consumes it yet.
 * A surface injecting one of these upgrades recall from keyword/FTS to embedding nearest-neighbor
 * without any change to the neutral library (this port may be revised when the backend actually lands).
 */
export interface ISemanticMemoryAdapter {
  /** Index a durable memory entry into the vector backend. */
  index(input: IAppendMemoryInput): Promise<void>;
  /** Query the vector backend for the most relevant slice within a budget. */
  query(text: string, budget: IMemoryBudget): Promise<ISemanticMemoryQueryResult>;
}
