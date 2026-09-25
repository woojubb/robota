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
import { getToolPermissionProfile, parseParameterRule, parsePattern } from './permission-gate.js';

import type { TMatchDirection } from './argument-matchers.js';

/** A pattern and the reason it cannot be evaluated by the gate. */
export interface IPermissionPatternProblem {
  readonly pattern: string;
  readonly reason: string;
}

/** The shape of a parameter rule's argument: `name:` then anything but `//`, which is a URL scheme. */
const NAMED_ARGUMENT = /^[A-Za-z_]\w*:(?!\/\/)/;

/** A well-formed URL argument, used to ask the URL matcher whether the PATTERN side is readable. */
const URL_PROBE = 'https://probe.invalid/';

/**
 * An allow rule may glob the tool name only after a literal `<server>__` prefix (issue #3081): an
 * unanchored `*` or `Read*` would grant tools nobody named, including ones a later pack adds.
 */
function isAnchoredNameGlob(toolName: string): boolean {
  return toolName.slice(0, toolName.indexOf('*')).includes('__');
}

/**
 * The reason one pattern is malformed, or undefined when the gate can evaluate it.
 *
 * `direction` is the list the pattern sits in. Allow rules are held to a narrower grammar: no
 * parameter rules and no unanchored tool-name globs, because in an allow list either would grant
 * more than the operator could see.
 */
export function validatePermissionPattern(
  pattern: string,
  direction: TMatchDirection = 'deny',
): string | undefined {
  const trimmed = pattern.trim();
  if (trimmed === '') return 'is empty';
  if (trimmed.includes('(') && !trimmed.endsWith(')')) return 'opens "(" without closing it';
  const { toolName, argPattern } = parsePattern(trimmed);
  if (toolName === '') return 'names no tool';
  if (direction === 'allow' && toolName.includes('*') && !isAnchoredNameGlob(toolName)) {
    return 'globs the tool name without a literal "<server>__" prefix, which an allow rule may not do';
  }
  if (argPattern === undefined || argPattern === '*' || argPattern === '**') return undefined;
  if (argPattern === '') return 'has an empty argument pattern; write Tool or Tool(*) instead';
  if (toolName.includes('*')) {
    // Judged per tool at the gate — except that an allow rule may never name a parameter.
    return direction === 'allow' && NAMED_ARGUMENT.test(argPattern)
      ? 'matches a named parameter, which only deny and ask rules may do'
      : undefined;
  }
  const parameterRule = parseParameterRule(toolName, argPattern);
  if (parameterRule !== undefined && parameterRule !== 'primary') {
    return direction === 'allow'
      ? 'matches a named parameter, which only deny and ask rules may do'
      : undefined;
  }

  const profile = getToolPermissionProfile(toolName);
  // `name:value` against a tool whose parameters are not registered yet: whether it is a parameter
  // rule depends on the schema, which arrives when the session wraps its tools. It is checked again
  // then, before any turn runs; judging it now would refuse a valid rule.
  if (
    profile.parameters === undefined &&
    NAMED_ARGUMENT.test(argPattern) &&
    parseParameterRule(toolName, argPattern) === undefined
  ) {
    return undefined;
  }
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
  direction: TMatchDirection = 'deny',
): IPermissionPatternProblem[] {
  const problems: IPermissionPatternProblem[] = [];
  for (const pattern of patterns) {
    const reason = validatePermissionPattern(pattern, direction);
    if (reason !== undefined) problems.push({ pattern, reason });
  }
  return problems;
}

/**
 * Patterns that load but do not do what they say (issue #3081): a parameter rule naming the tool's
 * PRIMARY field. That field is matched by the ordinary `Tool(pattern)` form, so the gate treats the
 * rule as unevaluable (an ask, never a silent pass) and the operator is told how to write it.
 */
export function findPermissionPatternWarnings(
  patterns: readonly string[],
): IPermissionPatternProblem[] {
  const problems: IPermissionPatternProblem[] = [];
  for (const pattern of patterns) {
    const { toolName, argPattern } = parsePattern(pattern.trim());
    if (argPattern === undefined || toolName.includes('*')) continue;
    const profile = getToolPermissionProfile(toolName);
    const parameterRule = parseParameterRule(toolName, argPattern);
    if (
      parameterRule === undefined &&
      profile.parameters !== undefined &&
      profile.argument?.kind !== 'url' &&
      NAMED_ARGUMENT.test(argPattern)
    ) {
      // Most likely a misspelt parameter: read as an ordinary argument pattern, it rarely matches.
      problems.push({
        pattern,
        reason: `names no parameter of "${toolName}" (${profile.parameters.join(', ')}), so it is read as an ordinary argument pattern`,
      });
      continue;
    }
    if (parameterRule !== 'primary') continue;
    const key = getToolPermissionProfile(toolName).argument?.key ?? '';
    problems.push({
      pattern,
      reason: `names "${toolName}"'s primary field "${key}", so it asks on every call; write ${toolName}(${argPattern.slice(key.length + 1)}) instead`,
    });
  }
  return problems;
}
