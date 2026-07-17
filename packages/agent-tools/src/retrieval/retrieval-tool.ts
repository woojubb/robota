/**
 * SELFHOST-003: the `CodebaseRetrieval` tool — mirrors the `create*Tool(options)` pattern.
 *
 * Composes over the injected `IRetrievalAdapter` (via `IRetrievalToolOptions`). It carries NO corpus and
 * NO domain content itself — the adapter (built from a surface-supplied parser + corpus) does the
 * ranking. With no adapter the tool reports unavailability (it is added to the default set only when an
 * adapter is present — see `createDefaultTools`).
 */

import { z } from 'zod';

import { createZodFunctionTool } from '../implementations/function-tool';

import type { IRetrievalRankedSymbol, IRetrievalToolOptions } from './types.js';
import type { FunctionTool } from '@robota-sdk/agent-core';

/** Default token budget when the caller does not specify one. */
const DEFAULT_TOKEN_BUDGET = 1000;

const RetrievalSchema = z.object({
  activeFiles: z
    .array(z.string())
    .optional()
    .describe(
      'Repo-relative files currently in focus; the map is ranked toward what they reference.',
    ),
  mentionedIdentifiers: z
    .array(z.string())
    .optional()
    .describe('Symbol names to bias the map toward (e.g. identifiers named in the task).'),
  tokenBudget: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Maximum tokens for the returned map (default ${DEFAULT_TOKEN_BUDGET}).`),
});

type TRetrievalArgs = z.infer<typeof RetrievalSchema>;

/** Render the ranked symbols as a compact, deterministic repo map. */
function formatRepoMap(symbols: readonly IRetrievalRankedSymbol[]): string {
  return symbols
    .map((symbol) => `${symbol.file}:${symbol.line}  ${symbol.kind} ${symbol.name}`)
    .join('\n');
}

async function retrievalTool(
  args: TRetrievalArgs,
  options: IRetrievalToolOptions = {},
): Promise<string> {
  if (!options.adapter) {
    return 'Codebase retrieval is not available in this session.';
  }
  const result = await options.adapter.retrieve({
    ...(args.activeFiles ? { activeFiles: args.activeFiles } : {}),
    ...(args.mentionedIdentifiers ? { mentionedIdentifiers: args.mentionedIdentifiers } : {}),
    tokenBudget: args.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  });
  if (result.symbols.length === 0) {
    return 'No relevant symbols found within the token budget.';
  }
  return `Most relevant symbols (~${result.totalTokens} tokens):\n${formatRepoMap(result.symbols)}`;
}

export function createRetrievalTool(options: IRetrievalToolOptions = {}): FunctionTool {
  return createZodFunctionTool(
    'CodebaseRetrieval',
    'Retrieve the most relevant slice of the codebase (a ranked repo map of symbols) for the current task, within a token budget. Provide the files you are focused on and/or identifiers named in the task; returns the highest-centrality definitions first.',
    RetrievalSchema,
    async (params) => retrievalTool(params, options),
  );
}
