/**
 * Project memory barrel — the SDK-local facade the top-level entrypoint re-exports.
 *
 * - SELFHOST-008: neutral durable-memory port (`IMemoryStore`) + filesystem reference adapter;
 *   P4 adds the semantic decorator (the surface injects the concrete adapter); P6 exposes the
 *   surface-owned automatic-capture policy shape.
 * - NEUT-007: the candidate extractor's locale/domain heuristics are an injectable
 *   `IMemoryExtractorPolicy`; the bilingual/dev set is the exported, documented default.
 */
export {
  ProjectMemoryStore,
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
export { FileSystemMemoryStore, createFileSystemMemoryStore } from './file-system-memory-store.js';
export { SemanticMemoryStore, createSemanticMemoryStore } from './semantic-memory-store.js';
export type {
  IMemoryStore,
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
