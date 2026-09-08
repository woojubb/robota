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
