import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

/**
 * A hook that judges must distinguish "I verified this is OK" from "I could not verify".
 *
 * The `.mjs` scans have had a floor for this since `scan-guard-scope-fail-closed`; the shell layer
 * never did, and it is where the instances were. Measured over four days: an empty findings count
 * read as zero findings on the gate written to stop merges past unread findings — flagged by six
 * consecutive review rounds before it was fixed; an empty commit date short-circuited a recency
 * check entirely; a non-matching `grep` under `set -e` aborted a hook silently, exit 1, before a
 * single check ran; two hooks referenced a bare variable under `set -u` and turned a considered
 * refusal into a crash.
 *
 * Every one of those was repaired individually. This is the ratchet, and it is honest about what it
 * is: run against this tree today it finds nothing, because the repairs already landed. Its value is
 * that the next one cannot land — and a ratchet that says so is worth more than one that implies it
 * caught something.
 *
 * The split is the point. A hook that JUDGES a command must refuse when it cannot read its input;
 * a hook that REMINDS or FORMATS may legitimately stand down, and demanding a refusal from it would
 * be a guard firing on a correct state — the failure `guards-pass-silently` measures. Which kind a
 * hook is, is read from the hook itself: an operator-facing `Blocked:` line is what a judging hook
 * has and an advisory one does not.
 */
const SHELL_HOOKS = readdirSync(HOOKS_DIR)
  .filter((n) => n.endsWith('.sh'))
  .sort()
  .map((name) => ({ name, text: readFileSync(path.join(HOOKS_DIR, name), 'utf8') }));

const JUDGING = SHELL_HOOKS.filter((h) => h.text.includes('Blocked:'));
const ADVISORY = SHELL_HOOKS.filter((h) => !h.text.includes('Blocked:'));

/** Inputs a hook may receive and cannot act on: it does not know what it was asked to judge. */
const UNREADABLE = [
  { label: 'a payload that is not JSON', input: 'not json at all' },
  { label: 'an empty payload', input: '' },
];

function run(hook, input, env = {}) {
  const result = spawnSync('bash', [path.join(HOOKS_DIR, hook)], {
    input,
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

describe('a hook that judges refuses what it cannot read', () => {
  it('finds hooks of both kinds', () => {
    // Fail closed: if the classifier stops matching, both lists empty and every case below passes
    // over nothing — the shape this whole file exists to keep out of the shell layer.
    expect(JUDGING.length).toBeGreaterThan(0);
    expect(ADVISORY.length).toBeGreaterThan(0);
  });

  for (const hook of JUDGING) {
    for (const { label, input } of UNREADABLE) {
      it(`${hook.name} refuses ${label}`, () => {
        const verdict = run(hook.name, input);

        expect(
          verdict.status,
          `it passed an input it could not read. Absent is not zero, and unreadable is not clean: ` +
            'a gate that treats "I do not know" as "fine" is a gate with a hole exactly the size of ' +
            'whatever broke its input.',
        ).not.toBe(0);
      });
    }
  }
});

describe('no hook crashes instead of deciding', () => {
  // A crash is not a refusal even when the exit code happens to be non-zero: it leaves the operator
  // with a shell diagnostic instead of the reason, and the considered `exit 2` never runs. Two hooks
  // shipped this way inside one week, both from a bare variable under `set -u`.
  const DEGRADED = [
    ...UNREADABLE,
    {
      label: 'a well-formed payload with no project directory',
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
      unsetProjectDir: true,
    },
  ];

  for (const hook of SHELL_HOOKS) {
    it(`${hook.name} survives a degraded environment`, () => {
      for (const scenario of DEGRADED) {
        const env = scenario.unsetProjectDir
          ? Object.fromEntries(
              Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR'),
            )
          : {};
        const verdict = scenario.unsetProjectDir
          ? spawnSync('bash', [path.join(HOOKS_DIR, hook.name)], {
              input: scenario.input,
              cwd: WORKSPACE_ROOT,
              encoding: 'utf8',
              env,
              timeout: 60_000,
            })
          : null;
        const output = verdict
          ? `${verdict.stdout ?? ''}${verdict.stderr ?? ''}`
          : run(hook.name, scenario.input).output;

        expect(output, `${hook.name} crashed on ${scenario.label}`).not.toMatch(
          /unbound variable|바인딩 해제|syntax error|command not found/,
        );
      }
    });
  }
});
