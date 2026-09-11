# Learn — cheap local capture for mid-task findings

Issue-registration policy (2026-09): a finding noticed mid-task is recorded HERE, not filed as a
GitHub Issue and not turned into a Task. No network call, no `gh` invocation, no new backlog item —
append one record below and return to the work in flight. See
[find-to-issue](skills/find-to-issue/SKILL.md) for when to use this file, and
[learning-loop.md](rules/learning-loop.md) for how entries here are later worked as a batch, only
when the user explicitly asks for lesson processing.

## Entry format

Append under a stable ID. Five fields, no more: category, severity and a fix are not required here —
they are decided later, at lesson time, not by the person who noticed the thing.

```md
### LRN-<stable-id>

- observed-at: <ISO timestamp>
- observation: <one sentence>
- evidence: <file:line, command output, or URL — at least one>
- source: <current Task ID or session>
- related: <known Issue/Task/PR ID, omit if none>
```

Seeing the same thing again is not a new record — add a dated evidence line under the existing entry
instead. If you cannot find the existing ID with a quick search, record a new one anyway; reconciling
near-duplicates happens in batch, at lesson time.

## Records

<!-- Append new `### LRN-<id>` entries below this line. Nothing above it is a record. -->

### LRN-work-run-removal-stale-evidence

- observed-at: 2026-09-08T14:40:00+09:00
- observation: Removing the work-run measurement subsystem from develop left the examined-scan adoption baseline and completed-task Evidence references pointing at deleted work-run files, so the affected harness scan still fails on historical residue.
- evidence: `scripts/harness/examined-adoption-baseline.json:161`; `scripts/harness/check-done-evidence.mjs`; affected scan output lists deleted `scripts/harness/work-run-*.mjs` references in completed INFRA-148, INFRA-150 and PROC-028 records
- source: INFRA-2662 lane-floor correction, 2026-09-08
- related: INFRA-2662

### LRN-task-merged-citation-open-cli-records

- observed-at: 2026-09-09T00:20:00+09:00
- observation: The final affected harness scan still finds the CLI-1990 and CLI-2004 Task records
  marked `in-progress` even though merged delivering commits cite those work-item IDs and deliver
  outside `.agents/`; the GitHub issues are already closed, but the repository Task lifecycle records
  still need a separately gated reconciliation.
- evidence: `scripts/harness/scan-task-merged-citation.mjs`; commits `4d2de8bf9` (CLI-1990) and
  `d63faff18` (CLI-2004); final `run-all-scans.mjs --affected --context pr` output on INFRA-2662
- source: INFRA-2662 final affected scan, 2026-09-09
- related: CLI-1990, CLI-2004, INFRA-2662

### LRN-work-run-measurement-direct-push-gap

- observed-at: 2026-09-06T09:55:00Z
- observation: `pre-push-work-run.mjs` assumes a claim→PR lifecycle and throws an uncaught,
  stack-trace-shaped error (`invalid-closure-commit`, `invalid-commit-trailers`) instead of a
  readable `[pre-push-check]`-style message when a direct-to-`develop` push (no PR) hits it; a
  local CLI misuse (`work-run.mjs abandon` with no args executes immediately instead of failing
  closed like `exclude`) forced recovering by rewriting local commit trailers with
  `git filter-branch`. `.github/workflows/scans-full.yml` already excludes this same scan
  (`--skip work-run-measurement`) from the blocking integration suite, so CI does not trust it
  either.
- evidence: scripts/harness/pre-push-work-run.mjs:121; scripts/harness/work-run-git-adapter.mjs:228
  (validateCommitCorrelation requires every commitOid's trailer to equal the CURRENT runId, so
  claim→abandon→re-claim leaves earlier commits permanently mismatched without a rewrite);
  full account: /tmp/robota-session-difficulties-report-2026-09-06.md
- source: fix/issue-registration-no-auto-create (HARNESS-102 work)
- related: git-branch.md's maintainer-direct-push allowance vs track-work-run's "claim through
  first PR" framing; the several chore/allow-develop-direct-merge* branches on this repo suggest
  the same gap is already being worked elsewhere

### LRN-lane-declaration-table-row-projection

- observed-at: 2026-09-06T13:07:58Z
- observation: `scan-lane-declaration.mjs`'s `isLifecycleProjectionOnly()` recognizes a child
  Task's lifecycle-bookkeeping update only in the checklist-bullet shape
  (`- [x] ID — status — \`path\``, as AGREEMENT-008 uses). The identical bookkeeping fact recorded
as a markdown table row (INFRA-155's `| ABSORB Issue | Exact live Task |`mapping) is NOT
recognized, so closing an L1 child Task and repointing its citation in an L2 parent's table
forces that L1 branch's lane-declaration floor to L2 — disproportionate for a one-line path fix.
Worked around for now via a`scan-task-path-citations.mjs` `SENTENCE_CONTRADICTS_REPAIR`
  exemption instead of fixing the row directly.
- evidence: scripts/harness/scan-lane-declaration.mjs (`LIFECYCLE_PROJECTION_ROW` regex,
  `isLifecycleProjectionOnly`); scripts/harness/scan-task-path-citations.mjs (exemption added for
  `.agents/spec-docs/active/INFRA-155-authorize-the-final-rule-023-bulk-migration.md`); repro: any
  edit to INFRA-155's ABSORB table row on a branch declaring `Lane: L1` fails
  `lane-declaration summary: ... result=FAIL` with "conflicting declarations"
- source: fix/refactor-027-phantom-ports-v2 (REFACTOR-027 work)
- related: AGREEMENT-008's exempted checklist-bullet rows (same bookkeeping purpose, recognized
  shape); a follow-up would extend `LIFECYCLE_PROJECTION_ROW` (or add a sibling pattern) to also
  match a `| issue #NNNN | \`<task-path>\` |` table row whose only changed content is the path

### LRN-scenario-author-must-isolate-home

- observed-at: 2026-09-07T14:40:00Z
- observation: a `user-execution-scenario-author` worker, proving executability for CLI-1994, ran
  `pnpm exec robota --configure-provider … --set-current` against the REAL user environment. That
  command upserts into `~/.robota/settings.json` (`applyProviderConfiguration` →
  `mergeProviderPatch` → `upsertProviderProfile`, `packages/agent-framework/src/command-api/provider/`),
  so it wrote a placeholder `probe` profile and `currentProvider` into the user's global settings.
  Because the write is an upsert, the post-write file (`providers: { probe }` only, `telemetry: true`
  preserved) shows the file previously held no provider profiles — nothing of substance was lost — but
  the birthtime/mtime and formatting changed and the agent could not prove that without reading the
  code. The worker itself later switched to an isolated `HOME` under `mkdtemp`, which is what every
  executability probe must do from the start.
- evidence: `packages/agent-framework/src/command-api/provider/provider-configuration.ts`
  (`applyProviderConfiguration` reads then merges), `provider-settings.ts` (`mergeProviderPatch` →
  `upsertProviderProfile`); the worker's own report; `~/.robota/settings.json` afterwards.
- source: CLI-1994 PLAN-mode scenario authoring, 2026-09-07
- related: the orchestrator's author brief must state "run every product command with `HOME` set to a
  fresh temporary directory (and a temporary project dir); never touch `~/.robota`". Candidate for a
  hard rule in `.claude/agents/user-execution-scenario-author.md` and for a harness guard that refuses
  `--configure-provider` / `--set-current` when `HOME` is the real home inside an agent session.

### LRN-pre-push-subshell-accounting-regression

- observed-at: 2026-09-09T01:35:00+09:00
- observation: The merged HARNESS-083 fast path still rescanned every ordinary statement's mask to
  count subshell parentheses. A 100–200 statement `echo … && git push` chain therefore stalled the
  affected contract shard until its 360-second deadline, even though the command contained no
  subshell syntax. Guarding that accounting behind a visible `(`/`)` check restores the intended
  linear path without changing directory-state handling for statements that can contain groups or
  substitutions.
- evidence: `.claude/hooks/pre-push-check.sh` subshell-accounting block; `pre-push-repo-resolution`
  long-chain regression; measured 200-statement probe completed in under one second after the guard.
- source: INFRA-2662 pre-push verification, 2026-09-09
- related: HARNESS-083 (issue #1681), INFRA-2662

### LRN-pre-push-here-string-pipe-deadlock

- observed-at: 2026-09-09T02:03:00+09:00
- observation: The pre-push statement walk fed `STATEMENT_RANGES` through a Bash here-string. When a
  long command produced enough ranges to fill the here-string pipe, Bash blocked while preparing the
  redirection before the loop could read it. The same shape can occur for a large per-statement word
  list. Process substitution keeps the producer and consumer concurrent without changing the parsed
  data.
- evidence: `sample` captured `pre-push-check.sh` in `heredoc_write` with no child process; replacing
  the three loop here-strings with `printf` process substitutions removes the pipe back-pressure.
- source: INFRA-2662 affected-contract verification, 2026-09-09
- related: HARNESS-083 (issue #1681), INFRA-2662

### LRN-merge-gate-wide-fixture-must-drain-stdout

- observed-at: 2026-09-09T02:34:00+09:00
- observation: The wide moved-base regression fixture used a Node `git` stub that called
  `process.exit(0)` immediately after `console.log`. A 351-file response was truncated at 512 bytes,
  so the overlap after the 300th file disappeared and the test passed the wrong answer.
- evidence: the test failed with `MOVED_RAW` at 512 bytes and 18 lines; replacing the immediate exit
  with a normal `stdout.write` drain makes the fixture expose the full response.
- source: INFRA-2662 full contract verification, 2026-09-09
- related: PROC-016, issue #2386

### LRN-hook-test-runner-must-drain-large-stdout

- observed-at: 2026-09-09T02:38:00+09:00
- observation: `remaining-hooks-run.test.mjs` used synchronous child execution while
  `spec-first-gate.sh` legitimately emits a multi-kilobyte heredoc. The child filled stdout before
  exiting, while the synchronous parent waited for exit before draining it, deadlocking the contract
  shard.
- evidence: the child stack stayed in Bash `heredoc_write`; converting the helper to asynchronous
  `spawn` with live stdout/stderr listeners lets the same four spec-first cases complete.
- source: INFRA-2662 full contract verification, 2026-09-09
- related: PROC-003, remaining-hooks-run contract

### LRN-spec-first-gate-heredoc-must-not-feed-external-cat

- observed-at: 2026-09-09T02:49:00+09:00
- observation: The live `spec-first-gate.sh` feature path itself deadlocked before producing its
  reminder. Bash prepared the multi-kilobyte heredoc through a pipe whose writer could fill before
  the consumer process was available.
- evidence: a direct JSON-piped invocation stayed in `heredoc_write`; splitting the reminder into
  bounded heredoc chunks returns immediately and preserves the reminder text.
- source: INFRA-2662 contract-gate verification, 2026-09-09
- related: PROC-003, INFRA-2662

### LRN-plan-order-history-fixture-must-run-isolated

- observed-at: 2026-09-09T03:03:00+09:00
- observation: The plan-order repository-contract fixture creates and scans enough real Git history
  to exceed the four-way contract shard deadline, and Vitest reports an `onTaskUpdate` timeout even
  after all assertions pass.
- evidence: the individual file completed in about four minutes with one unhandled worker timeout;
  capturing fixture Git stderr, splitting the large parameter loops into per-case tests, and running
  the file in one isolated thread worker remove the worker starvation and shard deadline.
- evidence (2026-09-11): `pnpm exec vitest run scripts/harness/__tests__` completed 321 files and
  6,281 assertions, then exited 1 solely because Vitest reported the same unhandled
  `[vitest-worker]: Timeout calling "onTaskUpdate"` after this 190-second test file.
- source: INFRA-2662 full contract verification, 2026-09-09
- related: PROC-003, INFRA-2662

### LRN-plan-order-squash-merged-closeout

- observed-at: 2026-09-09T10:29:43+09:00
- observation: An atomic Task/spec archival closeout required by the completion rule cannot be pushed from a fresh `origin/develop` branch after the delivering implementation was squash-merged, because `user-execution-plan-order` requires an ancestor checkpoint that the squash merge does not preserve.
- evidence: `node scripts/harness/scan-user-execution-plan-order.mjs --staged` rejected the closeout with `proposed checkpoint does not stage the exact active Task/spec pair`; a linear sync attempt then rejected `second work-unit planning checkpoint transition ... INFRA-182-ci-green-develop-recovery.md`; `.agents/rules/backlog-execution.md` § Completion Steps requires the status update and `git mv` archival in one commit.
- source: MCP-2520 closeout, 2026-09-09
- related: MCP-2520, issue #2520, issue #2418

### LRN-mcp-2520-active-spec-stale-task-citations

- observed-at: 2026-09-09T23:50:00+09:00
- observation: The active MCP-2520 spec still cites eight Task paths at their pre-archival locations even though the corresponding records now live under `.agents/tasks/completed/`, so the repository task-path-citations scan fails before unrelated work can be pushed.
- evidence: `pnpm harness:pre-push` and `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`; `.agents/spec-docs/active/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md:10,80,157,158,220,222,333,334`.
- source: AGREEMENT-2515 parent pre-push verification, 2026-09-09
- related: MCP-2520, issue #2520

### LRN-dag-default-provider-dist-resolution

- observed-at: 2026-09-11T03:25:41+09:00
- observation: The default DAG-node package test suite cannot load the built-in default LLM provider set because its generated provider distribution imports the undeclared or unavailable `@robota-sdk/agent-provider-bytedance` package.
- evidence: `pnpm --filter @robota-sdk/dag-nodes-default test` exits 1 with `Cannot find package '@robota-sdk/agent-provider-bytedance' imported from packages/agent-builtin-providers/dist/node/index.js`; 10 of 13 tests fail before the current harness diagnostic code is reached.
- source: INFRA-2698 full-workspace verification, 2026-09-11
- related: INFRA-2698

### LRN-work-run-command-missing-entrypoint

- observed-at: 2026-09-11T23:26:00+09:00
- observation: The registered `harness:work-run` workflow points to `scripts/harness/work-run.mjs`, but that entrypoint is absent, so its documented completion step cannot execute.
- evidence: `package.json` defines `harness:work-run` as `node scripts/harness/work-run.mjs`; invoking `node scripts/harness/work-run.mjs --help` exits with `MODULE_NOT_FOUND`.
- source: BEHAVIOR-2698 completion
- related: BEHAVIOR-2698

### LRN-loop-ledger-duplicates-block-unrelated-ci

- observed-at: 2026-09-12T01:31:00+09:00
- observation: Current `origin/develop` contains duplicate sealed records in the architecture-audit-fanout ledger, so the mandatory `loop-run-records` scan fails before unrelated API-001 verification can proceed.
- evidence: `pnpm harness:verify-like-ci` after rebase onto `origin/develop` reports duplicate run IDs `r20260822105018`, `r20260822110951`, `r20260822113453`, `r20260822115612`, `r20260822120239`, and `r20260830100729` in `.agents/loop-runs/architecture-audit-fanout.jsonl`; `git show origin/develop:.agents/loop-runs/architecture-audit-fanout.jsonl` contains the first duplicated record at lines 1 and 18.
- source: API-001 final verification
- related: origin/develop commits 0f9277b56 and 9f8c4938a
