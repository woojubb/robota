---
title: 'HARNESS-083: the pre-push per-statement walk re-tokenizes the whole command O(N) times'
status: todo
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

- [ ] The whole command is tokenized a bounded number of times (ideally once), independent of the
      statement count.
- [ ] All existing pre-push resolution/sequence tests stay green (behavior unchanged).
- [ ] A micro-benchmark (or a large-N fixture) shows the walk no longer scales O(N²) in awk forks.
