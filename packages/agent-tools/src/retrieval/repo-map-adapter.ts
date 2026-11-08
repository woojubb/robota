/**
 * SELFHOST-003: neutral repo-map ranking adapter — mirrors `InMemorySandboxClient`.
 *
 * Ranks a corpus of source files by graph centrality relative to the active files / mentioned
 * identifiers, within a token budget. It is a NEUTRAL mechanism: it works on ANY repo given a corpus
 * and an injected source parser — it carries no repo paths and no domain content. The heavy parser is
 * injected as the duck-typed `IRetrievalSourceParser` (like `E2BSandboxClient` duck-types the E2B SDK),
 * and the corpus is supplied from the surface.
 *
 * P2 (index build + persistence): the corpus is parsed ONCE into an `IRepoMapIndex` at construction
 * (or supplied prebuilt/persisted via `{ index }`), so `retrieve()` ranks without re-parsing.
 *
 * Ranking model (aider repo-map style): a definition's score is the weighted number of references to it
 * across the corpus, references FROM an active file weighted higher (personalization), plus a boost for
 * a directly-mentioned identifier. Entries are emitted most-relevant-first, truncated to the budget.
 */

import { buildRepoMapIndex } from './repo-map-index.js';

import type {
  IRepoMapIndex,
  IRetrievalAdapter,
  IRetrievalCorpusFile,
  IRetrievalParsedFile,
  IRetrievalRankedSymbol,
  IRetrievalRequest,
  IRetrievalResult,
  IRetrievalSourceParser,
  IRetrievalSymbol,
} from './types.js';

/**
 * Construct from EITHER a prebuilt/persisted `index` (P2) OR a `parser` + `corpus` (parsed once at
 * construction). At least one form must be supplied (else the constructor throws); if both are given,
 * `index` takes precedence.
 */
export interface IRepoMapRetrievalAdapterOptions {
  /** Injected source parser (duck-typed) — required when building from a corpus. */
  parser?: IRetrievalSourceParser;
  /** The corpus to index, supplied from the surface — required when building from a corpus. */
  corpus?: IRetrievalCorpusFile[];
  /** A prebuilt/persisted index (SELFHOST-003 P2) — rank over this without re-parsing. */
  index?: IRepoMapIndex;
}

/** References from an active file weigh more (personalization toward the current focus). */
const ACTIVE_FILE_WEIGHT = 3;
/** A directly-mentioned identifier is a strong relevance signal. */
const MENTION_BOOST = 5;

/**
 * Estimate the token cost of one repo-map entry (neutral chars/4 heuristic). Uses the same rendering
 * shape the tool prints (`file:line  kind name`) so the budgeted estimate matches the emitted output.
 */
function estimateTokens(symbol: IRetrievalSymbol): number {
  const line = `${symbol.file}:${symbol.line}  ${symbol.kind} ${symbol.name}`;
  return Math.max(1, Math.ceil(line.length / 4));
}

const symbolKey = (s: IRetrievalSymbol): string => `${s.file}::${s.name}::${s.line}`;

export class RepoMapRetrievalAdapter implements IRetrievalAdapter {
  private readonly index: IRepoMapIndex;

  constructor(options: IRepoMapRetrievalAdapterOptions) {
    if (options.index) {
      this.index = options.index;
    } else if (options.parser && options.corpus) {
      this.index = buildRepoMapIndex({ parser: options.parser, corpus: options.corpus });
    } else {
      throw new Error('RepoMapRetrievalAdapter requires either { index } or { parser, corpus }.');
    }
  }

  async retrieve(request: IRetrievalRequest): Promise<IRetrievalResult> {
    const parsed = this.index.entries.map((entry) => ({
      file: entry.path,
      parsed: { definitions: entry.definitions, references: entry.references },
    }));
    const ranked = rankSymbols(parsed, request);
    return selectWithinBudget(ranked, request.tokenBudget);
  }
}

/** Index every definition in the corpus by its name (a name may be defined in several files). */
function indexDefinitions(
  parsed: ReadonlyArray<{ file: string; parsed: IRetrievalParsedFile }>,
): Map<string, IRetrievalSymbol[]> {
  const defsByName = new Map<string, IRetrievalSymbol[]>();
  for (const { parsed: file } of parsed) {
    for (const def of file.definitions) {
      const list = defsByName.get(def.name) ?? [];
      list.push(def);
      defsByName.set(def.name, list);
    }
  }
  return defsByName;
}

/** Score each definition by weighted reference count + personalization + mention boost. */
function rankSymbols(
  parsed: ReadonlyArray<{ file: string; parsed: IRetrievalParsedFile }>,
  request: IRetrievalRequest,
): IRetrievalRankedSymbol[] {
  const activeFiles = new Set(request.activeFiles ?? []);
  const mentioned = new Set(request.mentionedIdentifiers ?? []);
  const defsByName = indexDefinitions(parsed);
  const scoreByKey = new Map<string, number>();
  const bump = (s: IRetrievalSymbol, delta: number): void => {
    scoreByKey.set(symbolKey(s), (scoreByKey.get(symbolKey(s)) ?? 0) + delta);
  };

  // Graph edges: each reference to a defined name credits that name's definitions (skip self-file).
  for (const { file, parsed: source } of parsed) {
    const weight = activeFiles.has(file) ? ACTIVE_FILE_WEIGHT : 1;
    for (const ref of source.references) {
      for (const def of defsByName.get(ref) ?? []) {
        if (def.file !== file) bump(def, weight);
      }
    }
  }
  for (const name of mentioned) {
    for (const def of defsByName.get(name) ?? []) bump(def, MENTION_BOOST);
  }

  const ranked: IRetrievalRankedSymbol[] = [];
  for (const defs of defsByName.values()) {
    for (const def of defs) {
      ranked.push({
        ...def,
        score: scoreByKey.get(symbolKey(def)) ?? 0,
        tokens: estimateTokens(def),
      });
    }
  }
  // Deterministic: score desc, then file asc, then line asc, then name asc.
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.name.localeCompare(b.name),
  );
  return ranked;
}

/** Take the most-relevant-first prefix whose cumulative tokens fit the budget. */
function selectWithinBudget(
  ranked: readonly IRetrievalRankedSymbol[],
  tokenBudget: number,
): IRetrievalResult {
  const symbols: IRetrievalRankedSymbol[] = [];
  let totalTokens = 0;
  for (const entry of ranked) {
    if (totalTokens + entry.tokens > tokenBudget) break;
    symbols.push(entry);
    totalTokens += entry.tokens;
  }
  return { symbols, totalTokens };
}
