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
