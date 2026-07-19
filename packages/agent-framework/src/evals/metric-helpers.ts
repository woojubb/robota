/**
 * SELFHOST-011 P3 — optional NEUTRAL eval metric helpers (mechanism only).
 *
 * Each factory returns a pure `IMetric` over the SSOT `IExecutionResult`; the CONSUMER supplies the content (the
 * expected value / substring / pattern / tool name), so there is NO opinionated or domain metric set here (that
 * would be the Mastra-style erosion SELFHOST-011 Alternative-1 rejected + HARNESS-034 fences). These just save a
 * consumer from hand-writing the most common trivial checks.
 */

import type { IEvalCase, IMetric } from './eval-types.js';
import type { IExecutionResult } from '../interactive/types.js';

/**
 * The run response equals the expected string. Two forms:
 *   - `exactMatch('foo')` — a fixed expected applied to every case (homogeneous).
 *   - `exactMatch()` — reads each case's `evalCase.expected` (per-case; makes `parseEvalCases`' field live).
 * `trim` (default true) trims both sides before comparing.
 */
export function exactMatch(expected?: string, options: { trim?: boolean } = {}): IMetric {
  const trim = options.trim ?? true;
  const norm = (s: string): string => (trim ? s.trim() : s);
  return {
    name: 'exact-match',
    score: (result: IExecutionResult, evalCase?: IEvalCase): boolean => {
      const target = expected ?? evalCase?.expected;
      if (target === undefined) {
        return false; // no expected supplied (neither closure arg nor case) — cannot match
      }
      return norm(result.response) === norm(target);
    },
  };
}

/** The run response contains `substring`. */
export function includesText(substring: string): IMetric {
  return {
    name: 'includes-text',
    score: (result: IExecutionResult): boolean => result.response.includes(substring),
  };
}

/** The run response matches `pattern`. */
export function regexMatch(pattern: RegExp): IMetric {
  // Strip stateful flags (g/y) so `RegExp.lastIndex` does not leak across cases in the runner loop, which would
  // otherwise make the same pattern score inconsistently case-to-case.
  const stateless = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  return {
    name: 'regex-match',
    score: (result: IExecutionResult): boolean => stateless.test(result.response),
  };
}

/** The run response parses as JSON (a format probe — no domain schema opinion). */
export function responseIsJson(): IMetric {
  return {
    name: 'response-is-json',
    score: (result: IExecutionResult): boolean => {
      try {
        JSON.parse(result.response);
        return true;
      } catch {
        // allow-fallback: a parse failure IS the metric's `false` answer (not a swallowed error)
        return false;
      }
    },
  };
}

/** The run's tool trajectory includes a call to the named tool. */
export function usedTool(name: string): IMetric {
  return {
    name: `used-tool:${name}`,
    score: (result: IExecutionResult): boolean => result.toolSummaries.some((t) => t.name === name),
  };
}
