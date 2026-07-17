/**
 * SELFHOST-003 P2: repo-map index build + persistence.
 *
 * Builds the whole corpus into a parsed index ONCE (via the injected duck-typed parser), and
 * serializes it to a neutral JSON string the surface can persist. Ranking then runs over the index
 * without re-parsing on every `retrieve()`. Neutral: the corpus + parser are supplied by the caller;
 * this module holds no repo paths and no heavy dependency.
 */

import type {
  IRepoMapIndex,
  IRepoMapIndexChanges,
  IRepoMapIndexEntry,
  IRetrievalCorpusFile,
  IRetrievalSourceParser,
} from './types.js';

/** Persisted-schema version — bump when `IRepoMapIndex`'s serialized shape changes incompatibly. */
export const REPO_MAP_INDEX_VERSION = 1;

export interface IBuildRepoMapIndexOptions {
  /** Injected source parser (duck-typed; no heavy parser SDK becomes an `agent-tools` dependency). */
  parser: IRetrievalSourceParser;
  /** The corpus to index, supplied from the surface (no repo paths live in this package). */
  corpus: IRetrievalCorpusFile[];
}

/** Parse one corpus file into an index entry. */
function parseEntry(
  parser: IRetrievalSourceParser,
  file: IRetrievalCorpusFile,
): IRepoMapIndexEntry {
  const parsed = parser.parse(file.path, file.content);
  return { path: file.path, definitions: parsed.definitions, references: parsed.references };
}

/** Parse the whole corpus once into a serializable repo-map index. */
export function buildRepoMapIndex(options: IBuildRepoMapIndexOptions): IRepoMapIndex {
  return {
    version: REPO_MAP_INDEX_VERSION,
    entries: options.corpus.map((file) => parseEntry(options.parser, file)),
  };
}

/**
 * Apply corpus changes to a built index INCREMENTALLY (SELFHOST-003 P3): re-parse only the `upserted`
 * files and drop `removed` paths, reusing every unchanged entry. Returns a new index (the input is not
 * mutated). A file present in both `removed` and `upserted` is upserted (re-parse wins). Ranking over
 * the result is identical to a full rebuild of the changed corpus (entry order does not affect ranking).
 */
export function updateRepoMapIndex(
  index: IRepoMapIndex,
  changes: IRepoMapIndexChanges,
  parser: IRetrievalSourceParser,
): IRepoMapIndex {
  const upsertedFiles = changes.upserted ?? [];
  const touched = new Set<string>([
    ...(changes.removed ?? []),
    ...upsertedFiles.map((file) => file.path),
  ]);
  const kept = index.entries.filter((entry) => !touched.has(entry.path));
  const upserted = upsertedFiles.map((file) => parseEntry(parser, file));
  return { version: index.version, entries: [...kept, ...upserted] };
}

/** Serialize a built index to a neutral JSON string for persistence by the surface. */
export function serializeRepoMapIndex(index: IRepoMapIndex): string {
  return JSON.stringify(index);
}

/**
 * Restore a built index from its serialized form. Throws on malformed JSON or an unsupported
 * `version` — a stale/incompatible persisted index must be rebuilt, never silently mis-ranked.
 */
export function deserializeRepoMapIndex(serialized: string): IRepoMapIndex {
  const parsed = JSON.parse(serialized) as Partial<IRepoMapIndex>;
  if (parsed.version !== REPO_MAP_INDEX_VERSION) {
    throw new Error(
      `Unsupported repo-map index version ${String(parsed.version)} (expected ${REPO_MAP_INDEX_VERSION}); rebuild the index.`,
    );
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error('Malformed repo-map index: missing `entries`.');
  }
  for (const entry of parsed.entries) {
    if (
      typeof entry?.path !== 'string' ||
      !Array.isArray(entry?.definitions) ||
      !Array.isArray(entry?.references)
    ) {
      throw new Error('Malformed repo-map index: a corrupt entry — rebuild the index.');
    }
  }
  return { version: parsed.version, entries: parsed.entries };
}
