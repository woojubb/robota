/**
 * SELFHOST-008 — the neutral durable-memory port (P1R: async + role-segregated).
 *
 * `IMemoryStore` is the single DIP seam for the memory capability, mirroring the STRUCTURE of the
 * sandbox precedent (`ISandboxClient` in `@robota-sdk/agent-tools`): the port + its neutral reference
 * adapter live IN the package that owns memory's consumers (session-lifecycle assembly + `/memory`
 * command-api), NOT in `agent-core` and NOT in a new interface package. It unifies what today is split
 * across `ProjectMemoryStore` (durable write/read), `MemoryRetrievalService` (budgeted keyword recall),
 * and `PendingMemoryStore` (curation queue) so a surface can swap the whole store without editing the
 * library — and (P1R) is composed from segregated role interfaces so each consumer depends only on its slice.
 *
 * The surface is **async** (`Promise`-returning), matching the repo's I/O-capability port precedents
 * (`ISandboxClient`, `IRetrievalAdapter`) so a remote/heavy backend fits behind the same port. v1's recall
 * backend is the neutral keyword/FTS fs reference adapter (`FileSystemMemoryStore`, which wraps its sync fs
 * calls in resolved Promises — zero behavior change). The heavy semantic/vector backend is the SEPARATE,
 * duck-typed, async `ISemanticMemoryAdapter` (mirroring `IE2BSandboxAdapter`) — now injectable behind this
 * async port without a breaking migration; no vector-DB SDK becomes an `agent-framework` dependency.
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
 * Segregated role interfaces (ISP). The durable-memory capability is three distinct client roles —
 * a reader (startup injection needs only this), a writer, a recaller, and a curation queue. `IMemoryStore`
 * composes all four; a consumer depends only on the slice it uses. Every method is **async**
 * (`Promise`-returning), matching the repo's I/O-capability port precedents (`ISandboxClient`,
 * `IRetrievalAdapter`) so a remote/heavy backend — including the async `ISemanticMemoryAdapter` — fits
 * behind the same port without a breaking migration. The fs reference adapter wraps its synchronous `fs`
 * calls in already-resolved Promises (zero behavior change).
 */
export interface IDurableMemoryReader {
  /** The startup-memory index (budget-limited), injected into the system prompt. */
  loadStartupMemory(): Promise<IStartupMemory>;
  /** Summarize the memory index + topic files. */
  list(): Promise<IProjectMemorySummary>;
  /** Read a single topic's content ('' if absent). */
  readTopic(topic: string): Promise<string>;
}

export interface IMemoryWriter {
  /** Append a durable memory entry (deduplicated). */
  append(input: IAppendMemoryInput): Promise<IAppendMemoryResult>;
}

export interface IMemoryRecaller {
  /** Recall the most relevant topics for `query`, never exceeding `budget`. */
  recall(query: string, budget: IMemoryBudget): Promise<IMemoryRetrievalResult>;
}

export interface IMemoryCurationQueue {
  /** A pending candidate by id (undefined if absent). */
  getPending(id: string): Promise<IMemoryPendingRecord | undefined>;
  /** Pending candidates, optionally filtered by status. */
  listPending(status?: TMemoryCandidateStatus): Promise<IMemoryPendingRecord[]>;
  /** Transition a pending candidate to a new status with a reason. */
  markPending(
    id: string,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<IMemoryPendingRecord>;
  /** Insert or update a pending candidate with a status + reason. */
  upsertPending(
    candidate: IMemoryCandidate,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<void>;
}

/**
 * The neutral durable-memory port — the composition of the four role interfaces above. It is the single
 * DIP seam a surface swaps to change the whole backend (fs, FTS, or a semantic/vector store behind
 * `ISemanticMemoryAdapter`); startup injection, the `/memory` command path, and the post-turn capture
 * controller ALL read/write through it, so an injected store is authoritative everywhere (no split-brain).
 */
export interface IMemoryStore
  extends IDurableMemoryReader, IMemoryWriter, IMemoryRecaller, IMemoryCurationQueue {}

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
