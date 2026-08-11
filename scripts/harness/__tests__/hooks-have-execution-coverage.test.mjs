import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXECUTION } from '../lib/spawn-call-graph.mjs';

import { testExecutesHook } from '../check-regression-red-proof.mjs';

// LIMITS testExecutesHook: they hold here, and the third answer is judged for THIS consumer. The
// relation now reads the call graph, so it says UNDETERMINED where the spawn target is built at
// runtime — `guards-fail-closed` sweeps the hooks directory and runs whatever it finds. Counting
// that as coverage would satisfy this floor for every hook at once and leave it decorative, so only
// a resolved execution counts here, and the message says which of the two situations it found.

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
 * Does `source` execute `hook`? The rule is owned by `testExecutesHook`, not restated here.
 *
 * It lived in this file first, and the red-proof gate needed the same relation once it learned to
 * see hooks (INFRA-071) — a shell script is never in a module graph, so "the test SPAWNS it" is
 * what stands in for the import graph there. Two copies of a rule this exact is two things that
 * drift, and the drift would be silent in both directions: this floor and that gate would disagree
 * about whether a hook is covered while both stayed green.
 *
 * What the shared rule claims: it reads the call graph, so the script a spawn RECEIVES is what
 * counts — a hook named in a comment, in prose, or in a string the file never spawns is described,
 * not run. What it does not claim: that a path assembled at runtime can be named. That answer is
 * UNDETERMINED and is reported separately below rather than counted either way.
 */
function executionOf(source, hook) {
  return testExecutesHook(source.text, hook);
}

describe('every hook is executed by a test, not merely described by one', () => {
  it('finds hooks and tests to check', () => {
    // Fail closed: a moved directory would make every assertion below pass over nothing.
    expect(SHELL_HOOKS.length).toBeGreaterThan(0);
    expect(TEST_SOURCES.length).toBeGreaterThan(0);
  });

  for (const hook of SHELL_HOOKS) {
    it(`${hook} is run by at least one test`, () => {
      const runners = [];
      const unresolved = [];
      for (const source of TEST_SOURCES) {
        const answer = executionOf(source, hook);
        if (answer === EXECUTION.EXECUTES) runners.push(source.name);
        if (answer === EXECUTION.UNDETERMINED) unresolved.push(source.name);
      }

      expect(
        runners.length,
        `No test executes ${hook}. A hook nobody runs is a hook nobody has checked — the shape that ` +
          'left `worktree-cwd-guard` off in every real session with ten green tests beside it. Add a ' +
          'case that spawns it with a payload, and state which signal it depends on and who sends it.' +
          (unresolved.length > 0
            ? `\n\n${unresolved.join(', ')} may run it through a path built at runtime, which cannot ` +
              'be tied to this hook by reading the code. A sweep over the hooks directory is not a ' +
              'case about this hook: it states nothing about what this one must do.'
            : ''),
      ).toBeGreaterThan(0);
    });
  }
});
