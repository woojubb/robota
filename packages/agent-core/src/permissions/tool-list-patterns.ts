import { findInvalidPermissionPatterns } from './pattern-validation.js';

/**
 * A preset's tool LISTS as permission PATTERNS.
 *
 * ARCH-040 Group C (issue #1934). A preset names tools (`Read`, `Bash`); the enforcer matches
 * patterns (`Read(*)`). One function because two paths need the answer — the startup merge in
 * `create-session.ts` and the live re-application `/preset` performs — and a translation written
 * twice is one rename away from two sessions disagreeing about what the same preset permits.
 */
export function toolNamesToPatterns(names: readonly string[] | undefined): string[] {
  return (names ?? []).map((name) => `${name}(*)`);
}

/**
 * The enforcer's rules after a preset's lists are applied.
 *
 * The two lists combine differently, and the difference is the decision rather than a detail:
 *
 * - **the allowlist REPLACES** what the preset layer previously contributed — it states the complete
 *   permitted set, so a later, more specific layer supersedes the earlier answer;
 * - **the denylist UNIONS** — a denial is not weakened by a later layer that forgot to repeat it.
 *
 * `base` is what the session was configured with independently of any preset (its own settings,
 * defaults, command auto-allows). Those survive both operations: a preset chooses among what the
 * session permits, it does not widen it.
 */
export function applyPresetToolLists(
  base: { allow: readonly string[]; deny: readonly string[] },
  preset: { allowedTools?: readonly string[]; deniedTools?: readonly string[] },
): { allow: string[]; deny: string[] } {
  const allowed = toolNamesToPatterns(preset.allowedTools);
  // Issue #3081: tool names are globbed now, so a preset naming `*` or `Read*` would grant tools
  // nobody listed. Held to the allow grammar on every path — startup and a live `/preset` alike.
  const problems = findInvalidPermissionPatterns(allowed, 'allow');
  if (problems.length > 0) {
    const listed = problems.map(({ pattern, reason }) => `"${pattern}" ${reason}`).join('; ');
    throw new Error(`Invalid preset allowedTools: ${listed}.`);
  }
  return {
    allow: [...base.allow, ...allowed],
    deny: [...new Set([...base.deny, ...toolNamesToPatterns(preset.deniedTools)])],
  };
}
