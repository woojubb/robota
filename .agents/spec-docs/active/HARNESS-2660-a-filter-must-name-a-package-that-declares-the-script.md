---
status: in-progress
type: INFRA
tags: [harness, tooling]
lane: L2
---

# HARNESS-2660: A --filter must name a package that declares the script

Paired with `.agents/tasks/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`. Arising from [issue #2660](https://github.com/woojubb/robota/issues/2660).

## Problem

`packages/agent-transport-tui/vitest.pty.config.ts:6` instructs the reader to run the PTY suite with
`pnpm --filter @robota-sdk/agent-transport test:pty`. <!-- allow-undeclared-script: quoting the defect this item exists to fix -->
`@robota-sdk/agent-transport` is a real but
different workspace package: its `package.json` declares `build`, `typecheck`, `test`,
`test:coverage`, `scenario:verify`, `scenario:record`, `clean` and `prepublishOnly` — and no
`test:pty`. The package that owns the `test:pty` script and the 15 `*.ptytest.ts` files is
`@robota-sdk/agent-transport-tui` (`packages/agent-transport-tui/package.json:46`).

Reproduction: `pnpm --filter @robota-sdk/agent-transport test:pty` <!-- allow-undeclared-script: quoting the defect this item exists to fix -->
from the repository root. pnpm
selects one real package and finds no such script, so no PTY test executes. The reader who followed
the comment sees no failure — the "silence is not success" mode
[enforcement-architecture.md](../../rules/enforcement-architecture.md) names.

The comment was correct when written. `vitest.pty.config.ts` was created under
`packages/agent-transport/` by CLI-074 (`749a853517`, 2026-06-12) and moved to
`packages/agent-transport-tui/` by the per-concern split (`7a4fbcc2f4`, 2026-06-14). The split moved
the file and left the filter naming the package it came from — a moved file carrying its old
package's filter, not an author's typo.

Nothing mechanical relates a `--filter` to the script it names. `check-workspace-refs` and
`check-ghost-package-refs` answer only whether the package NAME resolves, and both are satisfied
here because `agent-transport` is a real package. The wrong half of the command is the script, and
no scan looks at it.

## Prior Art Research

Waived: the subject is this repository's own corpus asking whether a command it prints names a
script its own manifests declare. There is no external product whose documentation could inform it,
and the remedy is a precedent this repository already owns and applies twice
(`check-workspace-refs.mjs` → `check-ghost-package-refs.mjs`: one scan owns the resolution SSOT, a
sibling reuses it over a disjoint corpus). Researching outside products would return nothing this
repository's own precedent does not already state.

## Architecture Review

### Affected Scope

- `packages/agent-transport-tui/vitest.pty.config.ts` — the defective comment
- `scripts/harness/scan-filter-script-resolves.mjs` — new guard
- `scripts/harness/check-ghost-package-refs.mjs` — export the immutable-historical-record predicate
- `scripts/harness/run-all-scans.mjs` — scan registration
- `scripts/harness/scan-guard-scope-fail-closed.mjs` — fail-closed classification of the new finder
- `scripts/harness/__tests__/scan-filter-script-resolves.test.mjs` — new tests
- `scripts/harness/examined-adoption-baseline.json`, `measurement-provenance-pending.json`,
  `file-size-baseline.json` — registration baselines

### Alternatives Considered

1. Fix the comment only, with no guard.
   - Pro: one-line diff; zero new machinery, zero new false-positive surface.
   - Con: fixes today's copy and nothing else. The defect class is a package split moving a file
     away from the filter its comment names, and a split will happen again. The repository already
     has the evidence that the copy propagates: two spec documents written 2026-09-07 independently
     inherited the same wrong filter and were caught by a reviewing human, not by a machine.
2. Extend `check-workspace-refs` to also validate scripts.
   - Pro: no new scan; the workspace name set is already there.
   - Con: that scan's corpus is `package.json` `scripts` blocks and helper `.mjs` files — it does
     not read `.md` or `.ts` at all, which is where this defect lives. Widening its corpus makes one
     scan own two questions over two corpora, and the repository's own precedent is the opposite:
     `check-ghost-package-refs` was created as a sibling reusing `check-workspace-refs`' SSOT rather
     than growing it.
3. A new sibling scan reusing the existing SSOTs. **Chosen.**
   - Pro: matches the established sibling pattern; a disjoint question (does the script exist?) over
     a disjoint corpus (`*.md`, `*.ts`, `*.mjs`), reusing the workspace name set and the
     historical-record predicate rather than forking either.
   - Con: one more registered scan to run and maintain.

### Decision

**Delivery mode:** `single`

Alternative 3, with the guard deliberately narrow.

**What it flags.** Exactly one condition: a `pnpm --filter <pkg> <script>` occurrence where `<pkg>`
resolves to a workspace package and that package's `package.json` does not declare `<script>`.

**What it does not flag, and who owns it instead.** An UNRESOLVABLE filter token is *not* reported.
That question already has two owners — `check-workspace-refs` for the manifest/helper corpus and
`check-ghost-package-refs` for the markdown corpus — and reporting it here would be a third owner
for one fact. It is also the noisier half by two orders of magnitude: measured on `develop`, the
corpus carries 350 occurrences across 74 distinct unresolvable tokens, nearly all of them
deliberate — `<pkg>` and `@robota-sdk/<pkg>` placeholders, `./packages/**` path filters,
`@robota-sdk/dag-*` globs, `!@robota-sdk/agent-cli` negations, and fixture names inside the harness's
own tests. A guard that reported those would be silenced within a week.

**Reachability.** The corpus is `enumerate-files.mjs`' tracked-plus-unignored enumeration for
`*.md`, `*.ts` and `*.mjs`, so a filter written in a source comment (where this defect lives), in a
rule, in a skill or in a spec document is all reachable by the same walk. The defective line is a
`.ts` comment, which no existing markdown-only scan could have reached.

**Capability preservation.** Nothing is removed. `check-ghost-package-refs`' private
`isExcludedDoc` becomes an exported `isImmutableHistoricalRecord` with an unchanged body and an
unchanged single internal call site, so the existing scan's behaviour is byte-identical and the
predicate keeps one owner.

**Adversarial pass — the failure modes, each answered by construction.**

- *A false accusation against correct prose.* `pnpm` sub-commands that are not scripts (`exec`,
  `add`, `install`, `publish`, `dlx`, …) are skipped by name; `pnpm --filter <pkg> run <script>`
  resolves to the token after `run`; and a command token that is not script-shaped (`build/test`,
  ``build`+`test``, `build:bun:${os}-${arch}`, a line-continuation `\`) is skipped rather than
  guessed at.
- *A permanently-red guard nobody can fix.* Immutable historical records are excluded on exactly the
  grounds `check-ghost-package-refs` already excludes them: a command that was correct when the
  record was written is history, not drift. CLI-074's three occurrences are precisely this case —
  `agent-transport` DID own `test:pty` on 2026-06-12 — and rewriting them would falsify an accurate
  evidence record.
- *A guard that cannot be shown to fail.* Measured on `develop` before the fix, the corpus yields
  exactly one live finding: `packages/agent-transport-tui/vitest.pty.config.ts:6`. The guard is
  therefore RED on the unmodified tree and GREEN after the one-line fix, and the tests pin both
  directions plus the four skip rules above.
- *A vacuous pass over an absent tree.* The finder calls `requireGovernedTree` on `packages`, so a
  root without the workspace throws instead of certifying zero findings, and it is classified in
  `MANDATORY_TREE_GUARDS` where `scan-guard-scope-fail-closed` executes that claim.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `check-workspace-refs.mjs` and `check-ghost-package-refs.mjs` are the
      siblings; their SSOTs are reused, not forked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None. The scan reports findings or throws; it has no degraded mode. An absent `packages` tree is a
throw, never an empty pass.

## Solution

1. `packages/agent-transport-tui/vitest.pty.config.ts` — name `@robota-sdk/agent-transport-tui` in
   the run instruction.
2. `scripts/harness/check-ghost-package-refs.mjs` — rename the private `isExcludedDoc` to
   `isImmutableHistoricalRecord` and export it; body and call site otherwise unchanged.
3. `scripts/harness/scan-filter-script-resolves.mjs` — new scan: enumerate `*.md`, `*.ts`, `*.mjs`
   through `enumerate-files.mjs`, skip immutable historical records, extract every
   `pnpm --filter <pkg> [<pkg>…] <script>` occurrence, and report each occurrence whose package
   resolves in the workspace but whose script is undeclared. Reuse
   `listWorkspacePackageNames`-adjacent manifest reading for the name→scripts map, call
   `requireGovernedTree('packages')`, and print `::examined::`.
4. `scripts/harness/run-all-scans.mjs` — register as `filter-script-resolves`.
5. `scripts/harness/scan-guard-scope-fail-closed.mjs` — add the finder to `MANDATORY_TREE_GUARDS`.
6. `scripts/harness/__tests__/scan-filter-script-resolves.test.mjs` — tests for the refusal, each
   skip rule, the historical-record exclusion, and the fail-closed root.
7. Registration baselines — `examined-adoption-baseline.json`,
   `measurement-provenance-pending.json`, `file-size-baseline.json`.

## Affected Files

- `packages/agent-transport-tui/vitest.pty.config.ts`
- `scripts/harness/scan-filter-script-resolves.mjs`
- `scripts/harness/check-ghost-package-refs.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/scan-guard-scope-fail-closed.mjs`
- `scripts/harness/__tests__/scan-filter-script-resolves.test.mjs`
- `scripts/harness/examined-adoption-baseline.json`
- `scripts/harness/measurement-provenance-pending.json`
- `scripts/harness/file-size-baseline.json`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-filter-script-resolves.test.mjs`
      → exits 0, and exits 1 with the fix reverted
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/scan-filter-script-resolves.test.mjs` → exits 0 on the whole file, not only the new case
- [ ] TC-04: `node scripts/harness/scan-filter-script-resolves.mjs` on the tree with the original
      filter restored → exits 1 naming `packages/agent-transport-tui/vitest.pty.config.ts`; on the
      fixed tree → exits 0
- [ ] TC-05: `node scripts/harness/check-ghost-package-refs.mjs` → exits 0 (the export refactor
      changes nothing it reports)

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                     | Notes                                                       |
| ----- | ----------- | --------------------------------------------------- | ----------------------------------------------------------- |
| TC-01 | Unit        | `pnpm exec vitest run` on the named test            | RED with the fix reverted, GREEN with it                    |
| TC-02 | Suite       | `run-all-scans.mjs --affected --context pr`         | Regression — the affected set, not the full suite           |
| TC-03 | Unit        | `pnpm exec vitest run <path>.test.mjs`              | The whole test file                                         |
| TC-04 | Integration | The scan itself, both tree states                   | The guard's red-proof on the real tree, not a fixture alone |
| TC-05 | Regression  | `check-ghost-package-refs.mjs`                      | The export refactor is behaviour-preserving                 |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change is a harness guard and a source comment. Every product surface this contract recognises — the shipped `robota` CLI, its TUI, the browser UI and the public SDK — is untouched: no command an end user of Robota runs, no screen they see, and no SDK return value differs before and after. The only reader of the corrected line is a contributor running the repository's own test suite, which is not a product surface, and the guard itself is a repository check whose output never reaches a Robota user.

## Tasks

- [ ] `.agents/tasks/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md` — todo

## Evidence Log
### Note — GATE-WRITE ran without its guardian | 2026-09-07

`node scripts/harness/gate.mjs judge --gate GATE-WRITE` returned **20 PASS, 0 FAIL, 7
PENDING-GUARDIAN** and wrote no entry ("pending criteria are the guardian's to judge and record").
The seven semantic criteria were **not** judged in this session: the `backlog-gate-guard` agent was
not dispatched, because the session that authorised this work scoped the lane instruction to
deriving and declaring the lane, and forbids dispatching subagents unasked. Recorded here rather
than left silent, so the gap is visible to the next reader instead of being inferred from a missing
entry.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "Add the missing mechanical guard — this is the part that matters most, since the sweep only fixes today's copies. Write a scan (following the conventions of the existing scripts/harness/scan-*.mjs files, and register it in run-all-scans.mjs the way its siblings are) that extracts every `pnpm --filter <pkg> <script>` occurrence from tracked *.md, *.ts and *.mjs files and fails when <pkg> is a workspace package whose package.json does not declare <script>."
**Given:** 2026-09-07, this conversation
**Review fingerprint:** 1717fef5b423 (review 1dfc04fc, type/tags 44dc5ed5)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-07, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1717fef5b423) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/draft/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md` blob `477cf37569f3` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-07

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-07; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1445 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md",
  "specPath": ".agents/spec-docs/todo/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md",
    ".agents/tasks/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9615c90ffcee` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md` blob `229aec4b2535` (modified)
