/**
 * Refuse a malformed permission pattern where the operator WROTE it, not at the gate (issue #2428).
 *
 * CORE-049 made a pattern the gate cannot interpret UNEVALUABLE at evaluation time — a deny that
 * cannot be evaluated prompts rather than silently passing. That is the floor. But an operator who
 * wrote `WebFetch(https://a b)` or `Grep(src/**)`-style narrowing for a tool that declares no
 * argument learned of it only when an invocation reached the gate, one prompt at a time. This is
 * the loud surface above the floor: the same grammar, asked at load, answering with the pattern and
 * the reason before any turn runs.
 *
 * What is NOT refused here, and why: a pattern naming a tool with NO registered profile at all. A
 * profile arrives with the tool that defines it (CORE-030), and a config may legitimately name a
 * tool a later-loaded pack provides; for that pattern the gate's unevaluable route remains the
 * answer. A tool whose profile IS known but declares no argument is a different case — the pattern
 * can never be evaluated, whatever loads later.
 */

import { matchUrl } from './argument-matchers.js';
import { getToolPermissionProfile, parsePattern } from './permission-gate.js';

/** A pattern and the reason it cannot be evaluated by the gate. */
export interface IPermissionPatternProblem {
  readonly pattern: string;
  readonly reason: string;
}

/** A well-formed URL argument, used to ask the URL matcher whether the PATTERN side is readable. */
const URL_PROBE = 'https://probe.invalid/';

/** The reason one pattern is malformed, or undefined when the gate can evaluate it. */
export function validatePermissionPattern(pattern: string): string | undefined {
  const trimmed = pattern.trim();
  if (trimmed === '') return 'is empty';
  if (trimmed.includes('(') && !trimmed.endsWith(')')) return 'opens "(" without closing it';
  const { toolName, argPattern } = parsePattern(trimmed);
  if (toolName === '') return 'names no tool';
  if (argPattern === undefined || argPattern === '*' || argPattern === '**') return undefined;
  if (argPattern === '') return 'has an empty argument pattern; write Tool or Tool(*) instead';

  const profile = getToolPermissionProfile(toolName);
  if (profile.argument === undefined) {
    if (profile.riskClass === undefined) return undefined; // nobody has declared this tool yet
    return `tool "${toolName}" declares no argument key, so an argument-scoped pattern can never be evaluated`;
  }
  if (profile.argument.kind === 'url' && matchUrl(argPattern, URL_PROBE) === 'unevaluable') {
    return `does not fit the URL pattern grammar scheme://host[:port][/path] that "${toolName}" is matched by`;
  }
  return undefined;
}

/** Every pattern in `patterns` the gate could not evaluate, with its reason. */
export function findInvalidPermissionPatterns(
  patterns: readonly string[],
): IPermissionPatternProblem[] {
  const problems: IPermissionPatternProblem[] = [];
  for (const pattern of patterns) {
    const reason = validatePermissionPattern(pattern);
    if (reason !== undefined) problems.push({ pattern, reason });
  }
  return problems;
}
