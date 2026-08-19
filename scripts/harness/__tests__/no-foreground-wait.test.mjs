import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HOOK = fileURLToPath(
  new URL('../../../.claude/hooks/no-foreground-wait.sh', import.meta.url),
);

/**
 * Run the hook the way the harness runs it: the payload on stdin, the verdict as the exit code.
 * 2 = refused, 0 = permitted. Deliberately NOT a unit test of a helper — the defect this hook exists
 * for is a shape that four existing guards all exit 0 on, so the assertion has to be on the guard's
 * own verdict over a real command string.
 */
function verdict(command, env = {}) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return result.status;
}

describe('no-foreground-wait — refuses a turn spent waiting (D7)', () => {
  it('refuses the exact shape that killed 61 turns', () => {
    // `sleep 150; for n in …; do gh pr checks …` — foreground continuous-integration polling.
    expect(verdict('sleep 150; for n in 1 2 3 4 5; do gh pr checks 1815; sleep 30; done')).toBe(2);
  });

  it('refuses a bare sleep over the budget', () => {
    expect(verdict('sleep 300')).toBe(2);
  });

  it('reads the unit, so `sleep 2m` is 120 seconds and not 2', () => {
    expect(verdict('sleep 2m; echo done')).toBe(2);
  });

  it('sums the sleeps in a bounded loop rather than judging each one alone', () => {
    // 8 × 15s = 120s. A per-sleep threshold reads every one of these as compliant, which is why the
    // observed failure was a loop of SHORT sleeps.
    expect(verdict('for i in 1 2 3 4 5 6 7 8; do sleep 15; done')).toBe(2);
  });

  it('refuses an UNBOUNDED loop around a remote status read whatever its sleep budget', () => {
    // The turn ends when the REMOTE changes, and nothing in the command says when that is.
    expect(verdict('until gh pr view 1815 --json state; do sleep 30; done')).toBe(2);
    expect(verdict('while ! git ls-remote origin main; do sleep 10; done')).toBe(2);
  });

  it('does NOT multiply a sleep OUTSIDE the loop by the loop count', () => {
    // Reported on the pull request. `SLEEP_TOTAL * LOOP_FACTOR` multiplied every sleep in the
    // command by the iteration count, including ones the loop never runs: this waits 10 seconds and
    // was read as 70. The suite had no "sleep outside + unrelated bounded loop" case, which is why
    // the regression could land — so the case is here now, not just the fix.
    expect(verdict('sleep 10 && for i in 1 2 3 4 5 6 7; do echo $i; done')).toBe(0);
  });

  it('still multiplies a sleep INSIDE the loop body, which is the case that matters', () => {
    // The other side of the same split: 8 × 15s is a real 120-second wait and must still refuse.
    expect(verdict('for i in 1 2 3 4 5 6 7 8; do sleep 15; done')).toBe(2);
  });

  it('adds the outside sleep to the multiplied inside one', () => {
    // 150 outside + 5 × 30 inside = 300s. The original CI-polling shape, still caught after the
    // split — a fix that had made the outside sleep free would have let it through.
    expect(verdict('sleep 150; for n in 1 2 3 4 5; do gh pr checks 1815; sleep 30; done')).toBe(2);
  });

  it('permits a BOUNDED retry around the same call', () => {
    // Refused three times on this guard's own author while the network was dropping calls. A retry
    // ends on the first SUCCESS and its cost is capped by its iteration count, which the sleep
    // budget already judges — so the remote read alone must not condemn it. A guard that fires on
    // the workaround for an unrelated failure teaches people to pass the ack by reflex.
    expect(verdict('for i in 1 2 3; do gh api repos/o/r --jq .name && break; sleep 6; done')).toBe(
      0,
    );
  });
});

describe('no-foreground-wait — permits work, and the path it recommends (D7)', () => {
  it('permits an ordinary long-running command', () => {
    // A build or a test suite may take many minutes in the foreground and that is correct: the
    // thing refused is waiting for something ELSE to change, not spending time.
    expect(verdict('pnpm build')).toBe(0);
    expect(verdict('npx vitest run scripts/harness/__tests__/')).toBe(0);
  });

  it('permits a short sleep', () => {
    expect(verdict('sleep 5 && git status')).toBe(0);
  });

  it('permits the backgrounded form it tells you to use', () => {
    expect(verdict('until git ls-remote origin main | grep -q x; do sleep 30; done &')).toBe(0);
  });

  it("permits the harness's own run_in_background flag, which is not in the command text", () => {
    // The guard refused this minutes after landing — on a retry loop its own message had asked for.
    // The flag lives in the tool payload, so a guard reading only the command string cannot see it,
    // and refusing there means refusing the exact mechanism the refusal recommends.
    const result = spawnSync('bash', [HOOK], {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'sleep 300', run_in_background: true },
      }),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
  });

  it('permits an interpreter payload that merely CONTAINS the word sleep', () => {
    // This one blocked its own author while the guard was being written: `python3 -c "…sleep 300…"`
    // measured as a 600-second wait. Both library readers expand interpreter payloads on purpose —
    // a destructive `bash -c "git push --force"` must be judged as the push it is — so the split
    // that separates them is that a REAL sleep is its own word, while inside a payload it arrives
    // carrying its quote.
    expect(verdict('python3 -c "y = \\"sleep 300\\"; print(y)"')).toBe(0);
  });

  it('permits a non-Bash tool', () => {
    const result = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { command: 'sleep 300' } }),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
  });
});

describe('no-foreground-wait — the override cannot be switched on by text (D7)', () => {
  it('honours the inline override', () => {
    expect(verdict('FOREGROUND_WAIT_ACK=1 sleep 300')).toBe(2 - 2);
  });

  it('honours the ambient override', () => {
    expect(verdict('sleep 300', { FOREGROUND_WAIT_ACK: '1' })).toBe(0);
  });

  it('is NOT disarmed by a commit message that merely names the token', () => {
    // branch-guard learned this four times over: read off raw text, a mention switches the guard
    // off. The token is read off the MASKED statement, so quoted content is text and text cannot
    // vote.
    expect(verdict('git commit -m "note: FOREGROUND_WAIT_ACK=1 was tried" && sleep 300')).toBe(2);
  });

  it('is NOT disarmed by the pattern appearing inside a quoted argument', () => {
    expect(verdict('git commit -m "sleep 300 in a loop with gh pr checks was tried"')).toBe(0);
  });
});
