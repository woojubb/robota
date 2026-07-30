import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');
const TESTS_DIR = import.meta.dirname;

/**
 * The mechanical floor for the third question a guard must answer (PROC-003): **is it reached?**
 *
 * `enforcement-architecture.md` already required every guardian to have a mechanical floor, and
 * `.claude/hooks/` was the one layer without one. What that cost, measured:
 *
 * - `pre-push-check` matched with a `^` anchor while every command begins `cd <repo> && …`, so every
 *   push in a long session bypassed it silently.
 * - `worktree-cwd-guard` gated on an environment marker exported by nothing but its own tests, so it
 *   exited on its first line in every real session — with ten green tests beside it.
 * - `merge-gate` shipped with a reachability probe and no test of what it DECIDED, so a gate looking
 *   for a reviewer nobody uses would have passed.
 *
 * This asks the smallest question that catches the shape: does any test EXECUTE this hook? A hook
 * nobody runs is a hook nobody has checked, whatever else is asserted about its source.
 *
 * What it deliberately does not claim: that the environment a case supplies is one a real session
 * supplies. That stays judgement, and the rule asks for it to be stated beside the case.
 */
const SHELL_HOOKS = readdirSync(HOOKS_DIR)
  .filter((name) => name.endsWith('.sh'))
  .sort();

/** Test sources, read once. A hook is "executed" if a test spawns bash on its path. */
const TEST_SOURCES = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => ({ name, text: readFileSync(path.join(TESTS_DIR, name), 'utf8') }));

/**
 * Does `source` execute `hook`?
 *
 * Deliberately structural rather than clever: the file must name the hook AND hand a path to a
 * spawned shell. Naming it in a comment, or asserting over its source text, is not running it —
 * which is exactly the distinction this floor exists to draw.
 */
function executesHook(source, hook) {
  if (!source.text.includes(hook)) return false;
  return /spawnSync\(\s*'bash'|execFileSync\(\s*'bash'|spawn\(\s*'bash'/.test(source.text);
}

describe('every hook is executed by a test, not merely described by one', () => {
  it('finds hooks and tests to check', () => {
    // Fail closed: a moved directory would make every assertion below pass over nothing.
    expect(SHELL_HOOKS.length).toBeGreaterThan(0);
    expect(TEST_SOURCES.length).toBeGreaterThan(0);
  });

  for (const hook of SHELL_HOOKS) {
    it(`${hook} is run by at least one test`, () => {
      const runners = TEST_SOURCES.filter((source) => executesHook(source, hook)).map(
        (s) => s.name,
      );

      expect(
        runners.length,
        `No test executes ${hook}. A hook nobody runs is a hook nobody has checked — the shape that ` +
          'left `worktree-cwd-guard` off in every real session with ten green tests beside it. Add a ' +
          'case that spawns it with a payload, and state which signal it depends on and who sends it.',
      ).toBeGreaterThan(0);
    });
  }
});
