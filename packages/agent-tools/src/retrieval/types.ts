/**
 * SELFHOST-003: codebase-retrieval adapter contract (v1).
 *
 * Mirrors the sandbox port precedent (`ISandboxClient` in `../sandbox/types.ts`): the port + types live
 * in `agent-tools` and `createRetrievalTool({ adapter })` composes over the port. The neutral repo-map
 * ranking adapter (`./repo-map-adapter.ts`) implements this port; the heavy source parser is injected as
 * the duck-typed `IRetrievalSourceParser` (like `IE2BSandboxAdapter`), and the corpus is supplied from the
 * surface — so NO heavy parser SDK and NO repo paths live in this package.
 *
 * v1 backend = repo-map graph-centrality ranking (no natural-language query). The embedding-vector
 * backend (`query(nl_text) → top-k`) is a consciously deferred follow-up (P4) that may revise this port.
 */

/** A symbol (definition) extracted from a source file by the injected parser. */
export interface IRetrievalSymbol {
  /** Repo-relative file the symbol is defined in. */
  file: string;
  /** Symbol name (function/class/const/…). */
  name: string;
  /** Neutral definition kind (e.g. `function`, `class`); opaque to the ranker. */
  kind: string;
  /** 1-based line of the definition. */
  line: number;
}

/** One source file parsed into its definitions + the identifiers it references (graph edges). */
export interface IRetrievalParsedFile {
  /** Symbols defined in this file. */
  definitions: IRetrievalSymbol[];
  /** Identifiers this file references (edges toward other files' definitions). */
  references: string[];
}

/**
 * Duck-typed source-parser port (mirror `IE2BSandboxAdapter`): parse one file's source into its
 * definitions + references. Injected so no heavy parser SDK becomes an `agent-tools` dependency.
 */
export interface IRetrievalSourceParser {
  parse(file: string, content: string): IRetrievalParsedFile;
}

/** One corpus file (supplied from the surface — the package holds no repo paths). */
export interface IRetrievalCorpusFile {
  /** Repo-relative path. */
  path: string;
  /** File source. */
  content: string;
}

/**
 * A retrieval request: rank the corpus relative to the active files / mentioned identifiers within a
 * token budget. There is NO natural-language query in v1 (repo-map ranking) — that is the deferred
 * vector backend's shape.
 */
export interface IRetrievalRequest {
  /** Repo-relative files currently in focus; their references seed the ranking (personalization). */
  activeFiles?: string[];
  /** Extra identifiers to bias the ranking toward. */
  mentionedIdentifiers?: string[];
  /** Maximum tokens the ranked result may consume. */
  tokenBudget: number;
}

/** One ranked result entry (a relevant symbol), with its centrality score + token cost. */
export interface IRetrievalRankedSymbol {
  file: string;
  name: string;
  kind: string;
  line: number;
  /** Relevance score (higher = more central/relevant); ranker-defined, monotonic. */
  score: number;
  /** Estimated tokens this entry contributes to the budget. */
  tokens: number;
}

/** The result of a retrieval: ranked entries whose total tokens ≤ the request budget. */
export interface IRetrievalResult {
  /** Ranked entries, most relevant first; `sum(tokens) ≤ request.tokenBudget`. */
  symbols: IRetrievalRankedSymbol[];
  /** Total tokens across `symbols` (≤ budget). */
  totalTokens: number;
}

/** The retrieval adapter port (mirror `ISandboxClient`). `createRetrievalTool` composes over this. */
export interface IRetrievalAdapter {
  retrieve(request: IRetrievalRequest): Promise<IRetrievalResult>;
}

/** Tool options carrying the retrieval adapter (mirror `ISandboxToolOptions`). */
export interface IRetrievalToolOptions {
  adapter?: IRetrievalAdapter;
}

/**
 * One indexed corpus file (SELFHOST-003 P2): its parsed definitions + references. This is the parsed
 * form the ranker consumes, so a built index lets the adapter rank WITHOUT re-parsing the corpus on
 * every `retrieve()`.
 */
export interface IRepoMapIndexEntry {
  /** Repo-relative path. */
  path: string;
  /** Symbols defined in this file. */
  definitions: IRetrievalSymbol[];
  /** Identifiers this file references. */
  references: string[];
}

/**
 * A built, serializable repo-map index (SELFHOST-003 P2): the whole corpus parsed once. Persist it
 * (see `serializeRepoMapIndex`/`deserializeRepoMapIndex`) so retrieval is build-once, rank-many. The
 * `version` guards forward-compatibility of the persisted form.
 */
export interface IRepoMapIndex {
  /** Persisted-schema version. */
  version: number;
  /** One entry per corpus file, parsed. */
  entries: IRepoMapIndexEntry[];
}
