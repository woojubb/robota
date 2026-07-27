import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * The command forms a hook must recognise.
 *
 * A PreToolUse hook decides whether to act by matching the Bash command it is handed. Matching with
 * a `^`-anchor recognises only a command that BEGINS with the interesting verb — and essentially
 * every command issued here begins with `cd <repo>`, or puts the verb on a later line of a
 * multi-line block. Measured 2026-07-27: `pre-push-check` was anchored that way, so every push in a
 * long session bypassed it silently. The branch-hygiene rule it enforces was violated repeatedly and
 * the guard never spoke, which ended in a promotion-ancestry break.
 *
 * A hook that no realistic invocation reaches is indistinguishable from no hook. So the shapes below
 * are the contract: whatever a hook intercepts, it must intercept in all of them.
 */
const COMPOUND_FORMS = [
  (verb) => verb,
  (verb) => `cd ${WORKSPACE_ROOT}\n${verb}`,
  (verb) => `cd ${WORKSPACE_ROOT} && ${verb}`,
  (verb) => `git status; ${verb}`,
];

/**
 * Hooks that intercept command verbs, and commands they MUST recognise — **every** verb, not one.
 *
 * Listing one verb per hook is how this test was green while four of `branch-guard`'s five verbs
 * were unreachable: the one I happened to pick, `--delete`, has a separately un-anchored matcher.
 * A hand-listed set standing in for an enumerated one is a recurring defect in this repository, and
 * it recurred here inside the test written to catch a sibling of it.
 *
 * `branch-guard.sh` is deliberately absent below: repairing all five of its verbs is a larger change
 * to a hook another branch is rewriting, and pinning it here with one verb would restore exactly the
 * false assurance this comment records. It is covered by that branch's own suite, which derives each
 * hook's verbs from the hook's source rather than from a list.
 */
const INTERCEPTORS = [{ hook: 'pre-push-check.sh', verb: 'git push -u origin feat/probe' }];

/**
 * `spawnSync`, not `execFileSync`: hooks write their notices to stderr, and `execFileSync`'s SUCCESS
 * path returns stdout only — so a hook that spoke and exited 0 would read as silence and this test
 * would report a bypass that is not there. It did, on the first run.
 */
function runHook(hookFile, command) {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hookFile)], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE_ROOT },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('hooks are reachable from the command forms actually used', () => {
  it('finds the hooks it claims to check', () => {
    // Fail closed: a renamed hook would make every case below pass over nothing.
    const present = readdirSync(HOOKS_DIR);
    for (const { hook } of INTERCEPTORS) expect(present).toContain(hook);
  });

  for (const { hook, verb } of INTERCEPTORS) {
    // Generous timeout: reachability is measured by EXECUTING each hook, and a hook may legitimately
    // do real work once it has decided to act — `pre-push-check` runs `pnpm install` to check
    // lockfile sync. Eight executions against the default 10s limit passed locally at 9.97s and
    // timed out on the CI runner. The fix is the budget, not a lighter probe: replacing execution
    // with source inspection would test the matcher's TEXT rather than whether the hook is reached,
    // which is the whole question.
    it(`${hook} recognises its verb in every compound form`, { timeout: 120_000 }, () => {
      const reactions = COMPOUND_FORMS.map((shape) => {
        const result = runHook(hook, shape(verb));
        // "Reacted" = said something or refused. Silence with status 0 is the bypass being measured.
        return result.output.trim().length > 0 || result.status !== 0;
      });

      expect(
        reactions.every(Boolean),
        `${hook} stayed silent on ${reactions.filter((r) => !r).length} of ${reactions.length} ` +
          'command forms. A hook that only matches a command it also STARTS is unreachable from ' +
          '`cd <repo> && …` and from multi-line blocks, which is how commands are normally written.',
      ).toBe(true);
    });
  }

  it('does not react to an unrelated command', { timeout: 60_000 }, () => {
    // The other half: a matcher loose enough to fire on anything would pass the test above while
    // blocking ordinary work, which is how a guard gets disabled.
    for (const { hook } of INTERCEPTORS) {
      const result = runHook(hook, `cd ${WORKSPACE_ROOT}\necho hello`);
      expect(result.status, `${hook} blocked an unrelated command`).toBe(0);
      expect(result.output.trim(), `${hook} spoke on an unrelated command`).toBe('');
    }
  });

  it('anchors no interceptor pattern at the start of the command', () => {
    // The specific mistake, pinned by source: `grep -qE '^...git...'` over the extracted command.
    for (const { hook } of INTERCEPTORS) {
      const source = readFileSync(path.join(HOOKS_DIR, hook), 'utf8');
      const anchoredVerbMatch = /grep\s+-[a-zA-Z]*E?\s*'\^[^']*\\?s\*\(?[^']*git[^']*'/.test(
        source,
      );
      expect(anchoredVerbMatch, `${hook} matches its verb with a start-anchored pattern`).toBe(
        false,
      );
    }
  });
});
