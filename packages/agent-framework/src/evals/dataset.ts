/**
 * SELFHOST-011 P3 — pure dataset-TEXT parser for eval cases.
 *
 * The consumer supplies the corpus TEXT (they own the file/source); the library only parses it into the neutral
 * `IEvalCase[]` shape. There is deliberately NO file I/O here — the surface reads bytes (the `robota eval` CLI
 * already owns file loading) — so the library stays pure + no dataset content ships in `packages/`.
 */

import type { IEvalCase } from './eval-types.js';

/** One raw case row as parsed from a dataset (optimistically typed; validated by `toEvalCase`). */
interface IRawCaseRow {
  input?: string;
  expected?: string;
}

function toEvalCase(row: IRawCaseRow, where: string): IEvalCase {
  if (!row || typeof row.input !== 'string') {
    throw new Error(`Invalid eval case (${where}): each case needs a string "input".`);
  }
  if (row.expected !== undefined && typeof row.expected !== 'string') {
    // A present-but-wrong-typed `expected` is malformed — throw loudly rather than silently dropping it.
    throw new Error(`Invalid eval case (${where}): "expected" must be a string when present.`);
  }
  return typeof row.expected === 'string'
    ? { input: row.input, expected: row.expected }
    : { input: row.input };
}

/**
 * Parse a consumer-supplied dataset into `IEvalCase[]`.
 *   - `'json'`  — a JSON array of `{ input, expected? }` rows.
 *   - `'jsonl'` — one JSON `{ input, expected? }` object per non-blank line.
 * Throws on malformed input (a broken corpus is a loud failure, not a silent skip).
 */
export function parseEvalCases(text: string, format: 'json' | 'jsonl'): IEvalCase[] {
  if (format === 'jsonl') {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, i) => toEvalCase(JSON.parse(line) as IRawCaseRow, `line ${i + 1}`));
  }
  const parsed = JSON.parse(text) as IRawCaseRow[];
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid eval dataset: JSON form must be an array of cases.');
  }
  return parsed.map((row, i) => toEvalCase(row, `index ${i}`));
}
