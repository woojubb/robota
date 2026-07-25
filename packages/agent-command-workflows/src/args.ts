/**
 * Shared argument grammar for every `/workflows` subcommand (WORKFLOW-005 P3).
 *
 * One tokenizer serves both argument shapes: the authoring subcommands (`create`/`build`, via
 * `parseCreateArgs`) and the file-taking subcommands (`validate`/`run`, via `parseFileArg`).
 * Previously only the authoring pair tokenized, so `validate`/`run` folded quotes and surplus tokens
 * straight into the path and reported them as a confusing ENOENT.
 */
import { subcommandUsage } from './subcommands.js';

/**
 * Split an argument string into tokens shell-style: unquoted whitespace separates tokens, and
 * single/double quotes (anywhere, e.g. `key="a b"`) protect whitespace and are stripped.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let hasContent = false;
  let quote: '"' | "'" | null = null;

  for (const ch of input) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
    } else if (/\s/.test(ch)) {
      if (hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

/** Outcome of parsing a subcommand's arguments. */
export type TParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse the argument of a file-taking subcommand (`validate`, `run`): exactly one token, quote-aware.
 * Zero tokens or more than one is a usage error — surplus tokens are never folded into the path.
 */
export function parseFileArg(argStr: string, subcommand: string): TParseResult<string> {
  const usage = subcommandUsage(subcommand);
  const tokens = tokenize(argStr.trim());
  const file = tokens[0];
  if (file === undefined) {
    return { ok: false, error: usage };
  }
  if (tokens.length > 1) {
    return {
      ok: false,
      error: `/workflows ${subcommand} takes a single file path, got ${tokens.length} arguments.\n${usage}`,
    };
  }
  return { ok: true, value: file };
}
