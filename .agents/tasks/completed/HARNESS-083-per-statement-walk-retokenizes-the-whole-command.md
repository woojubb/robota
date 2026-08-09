---
title: 'HARNESS-083: the pre-push per-statement walk re-tokenizes the whole command O(N) times'
status: done
completed: 2026-08-09
created: 2026-08-09
priority: medium
urgency: later
area: scripts/harness, .claude/hooks
depends_on: []
issue: https://github.com/woojubb/robota/issues/1677
---

# HARNESS-083: the pre-push per-statement walk re-tokenizes the whole command O(N) times

## Problem

`.claude/hooks/pre-push-check.sh`'s per-statement walk calls `hook_verb_scan`,
`hook_git_c_path`, and `hook_statement_words` once PER statement. Each of those functions forks a
fresh `awk` that tokenizes the ENTIRE command from the start — `WSTART`/`WLEN` only slice the
OUTPUT, they do not narrow the parse. For a command of N statements that is ~2N awk forks and
O(N²) tokenization work, in a SYNCHRONOUS hook that runs on every push.

Agents routinely write long `;`/`&&`-chained commands (tens to hundreds of statements), so the
cost is real and user-visible on exactly the shape the hook must handle.

## Evidence

Raised 2026-08-09 in #1667 review (SHOULD): "statement 수가 N개면 대략 O(N²) 스캔 비용 +
약 2N번의 awk 프로세스 fork … 이 동기 훅이 push마다 눈에 띄게 느려질 수 있습니다."

## Direction

Tokenize ONCE and reuse the token stream across statements, rather than re-parsing per statement:

- have the tokenizer emit the full token/statement structure a single time, and let the walk
  index into it, OR
- pass the already-masked whole-command scan into the per-statement readers so they slice a
  cached parse instead of re-forking `awk`.

Keep the current correctness (heredoc/quote/substitution masking, the worktree-aware resolution,
the `||`-guard from #1667) — this is a performance refactor, not a behavior change, so it must be
covered by the existing `pre-push-repo-resolution` / `pre-push-sequence` suites staying green.

## Acceptance

- [x] The whole command is tokenized ONCE (`COMMAND_VERBS`); every per-statement mask is a slice of
      it, so tokenization is independent of the statement count.
- [x] Every pre-existing pre-push resolution/sequence/hook-facts case stays green, untouched — the
      equivalence evidence that behaviour did not change. The suite now reports 88 because this
      change ADDS cases (large-N, spliced-cd ×3, the fork-count guard); none of the pre-existing
      ones were edited.
- [x] Large-N fixtures in `pre-push-repo-resolution.test.mjs` (200-statement chain resolves; a cd
      150 statements deep is still tracked; a spliced `"c""d"` still refuses) plus the measured
      table below: develop 9547 ms at N=200 versus 2788 ms, and flat in N.

## Test Plan

- Red-first is not applicable in its usual form: this is a PERFORMANCE change whose contract is
  that behaviour does not change, so the evidence is the inverse — every pre-existing pre-push,
  sequence and hook-facts case passes UNTOUCHED against the rewritten walk (88 total with the cases
  this change adds).
- Two rounds of a genuine regression WERE found this way and are now pinned: the raw-token skip let
  a spliced `cd` through (no `cd`-shaped substring), so the push resolved to the session repo and
  exited 0 where the hook had refused. The first fix blocklisted quote/backslash and review found
  `c$()d` and ` c`d `` straight through it, so the skip now takes an ALLOWLIST of inert characters
  and any expansion character forces the full walk. All three vectors are pinned as cases.
- STATED LIMIT, measured: a PARAMETER splice (`c${UNSET}d`) is still not tracked, because words-mode
  never builds the word `cd` from it. It behaves identically on develop, so this change neither
  introduced nor reopened it; filed as HARNESS-084 (#1682).
- Scale fixtures: a 200-statement chain resolves correctly, and a `cd` buried 150 statements deep is
  still tracked (the skip is conservative).
- `pnpm harness:scan` and the full harness suite (3092) green.

## User Execution Test Scenarios

**Does not apply — and the classification is the point of the entry.** This changes
`.claude/hooks/pre-push-check.sh`, which does run on every push in every session, so the
"harness-internal" label is not automatic. It qualifies because the change is defined by preserving
observable behaviour: there is no new user-facing surface, no new refusal, and no new permitted
shape. What a user would "run to see it" is any push — and the correct outcome is that it behaves
exactly as before, only faster. That invariance is what the untouched pre-existing tests assert,
which is
stronger evidence than a scripted scenario would be. The one behavioural difference the work did
produce (the spliced-`cd` fail-open) was a defect, and it is fixed and pinned rather than shipped.

## Resolution

Landed on branch `fix/harness-083-tokenize-once`. The whole-command mask is tokenized ONCE
(`COMMAND_VERBS`, already computed and now guarded fail-closed), and each statement's mask is a
byte-aligned SLICE of it — no `hook_verb_scan` fork per statement. A non-directory statement (its
raw slice carries no `cd`/`pushd`/`popd` token, matched bash-natively) skips the `hook_statement_words`
fork entirely, and the push-detection grep is short-circuited by a bash `*push*` pre-filter. So an
ordinary long chain (`echo a && … && git push`) spends no per-statement fork; the exact grep/awk
engines still DECIDE the statements that could be pushes or directory changes, so behavior is
unchanged (every pre-existing pre-push/hook-facts case passes untouched; the suite reports 88
with the cases this change adds).

Measured (200 ordinary statements before a push):

| N   | develop | fixed   |
| --- | ------- | ------- |
| 1   | 2705 ms | 2719 ms |
| 60  | 3567 ms | 2702 ms |
| 200 | 9547 ms | 2788 ms |

develop grows super-linearly; the fixed hook is flat in N. Large-N correctness fixtures added to
`pre-push-repo-resolution.test.mjs` (a 200-statement chain resolves correctly; a cd buried 150
statements deep is still tracked — the skip is conservative). The remaining ~2.7s is the fixed
baseline of the hook's git operations against the resolved repo, unrelated to the statement count.
