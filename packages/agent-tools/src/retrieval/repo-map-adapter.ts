/**
 * SELFHOST-003: neutral repo-map ranking adapter (v1) — mirrors `InMemorySandboxClient`.
 *
 * Ranks a corpus of source files by graph centrality relative to the active files / mentioned
 * identifiers, within a token budget. It is a NEUTRAL mechanism: it works on ANY repo given a corpus
 * and an injected source parser — it carries no repo paths and no domain content. The heavy parser is
 * injected as the duck-typed `IRetrievalSourceParser` (like `E2BSandboxClient` duck-types the E2B SDK),
 * and the corpus is supplied from the surface.
 *
 * Ranking model (aider repo-map style): a definition's score is the weighted number of references to it
 * across the corpus, references FROM an active file weighted higher (personalization), plus a boost for
 * a directly-mentioned identifier. Entries are emitted most-relevant-first, truncated to the budget.
 */

import type {
  IRetrievalAdapter,
  IRetrievalCorpusFile,
  IRetrievalParsedFile,
  IRetrievalRankedSymbol,
  IRetrievalRequest,
  IRetrievalResult,
  IRetrievalSourceParser,
  IRetrievalSymbol,
} from './types.js';

export interface IRepoMapRetrievalAdapterOptions {
  /** Injected source parser (duck-typed; no heavy parser SDK becomes an `agent-tools` dependency). */
  parser: IRetrievalSourceParser;
  /** The corpus to rank over, supplied from the surface (no repo paths live in this package). */
  corpus: IRetrievalCorpusFile[];
}

/** References from an active file weigh more (personalization toward the current focus). */
const ACTIVE_FILE_WEIGHT = 3;
/** A directly-mentioned identifier is a strong relevance signal. */
const MENTION_BOOST = 5;

/** Estimate the token cost of one repo-map entry (neutral chars/4 heuristic). */
function estimateTokens(symbol: IRetrievalSymbol): number {
  const line = `${symbol.file}:${symbol.line} ${symbol.kind} ${symbol.name}`;
  return Math.max(1, Math.ceil(line.length / 4));
}

const symbolKey = (s: IRetrievalSymbol): string => `${s.file}::${s.name}::${s.line}`;

export class RepoMapRetrievalAdapter implements IRetrievalAdapter {
  constructor(private readonly options: IRepoMapRetrievalAdapterOptions) {}

  async retrieve(request: IRetrievalRequest): Promise<IRetrievalResult> {
    const parsed = this.options.corpus.map((file) => ({
      file: file.path,
      parsed: this.options.parser.parse(file.path, file.content),
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
