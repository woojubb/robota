/**
 * Project memory barrel — the SDK-local facade the top-level entrypoint re-exports.
 *
 * - Neutral durable-memory port (`IMemoryStore`) + filesystem reference adapter; the semantic
 *   decorator (the surface injects the concrete adapter); the surface-owned automatic-capture
 *   policy shape.
 * - The candidate extractor's locale/domain heuristics are an injectable
 *   `IMemoryExtractorPolicy`; the bilingual/dev set is the exported, documented default.
 */
export {
  ProjectMemoryStore,
  MemoryTopicCuratedError,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_MAX_BYTES,
  isMemoryType,
} from './project-memory-store.js';
export type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IProjectMemorySummary,
  IStartupMemory,
} from './project-memory-store.js';
export { WorkspaceMemoryStore, createWorkspaceMemoryStore } from './file-system-memory-store.js';
export { approvePendingMemoryCandidate } from './memory-approval.js';
export type { IApprovedMemoryCandidate } from './memory-approval.js';
export { SemanticMemoryStore, createSemanticMemoryStore } from './semantic-memory-store.js';
export type {
  IMemoryStore,
  IMemoryTopicMutationResult,
  IDurableMemoryReader,
  IMemoryWriter,
  IMemoryRecaller,
  IMemoryCurationQueue,
  IMemoryBudget,
  IPerTurnRecallConfig,
  ISemanticMemoryAdapter,
  ISemanticMemoryQueryResult,
} from './types.js';
export type { IAutomaticMemoryConfig, TMemoryPolicyMode } from './automatic-memory-types.js';
export {
  DEFAULT_MEMORY_EXTRACTOR_POLICY,
  RegexMemoryCandidateExtractor,
} from './memory-candidate-extractor.js';
export type {
  IMemoryCandidateExtractor,
  IMemoryExtractorPolicy,
  IMemoryExtractorTrigger,
} from './memory-candidate-extractor.js';
