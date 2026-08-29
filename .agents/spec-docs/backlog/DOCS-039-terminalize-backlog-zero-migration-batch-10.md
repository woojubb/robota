---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-039: Terminalize backlog-zero migration batch 10

## Problem

ARCH-047, ARCH-048, and ARCH-049 are old root Task records whose exact implementation ownership is
already represented by OPEN, unassigned GitHub issues #2151, #2152, and #2153. Keeping both records
active creates the duplicate durable queue that `BACKLOG-ZERO-MIGRATION` is intended to remove. The
three premises remain valid, so this batch hands them off rather than declaring the implementation
complete. Reproduction: `rg -n 'ARCH-04[789]' packages/agent-framework/docs/SPEC.md
packages/agent-cli/docs/SPEC.md packages/agent-session/docs/SPEC.md packages/agent-session/README.md`
shows four live links to the root Task paths; archiving those Tasks without rekeying the carriers
would leave broken references and a stale local queue.

## Prior Art Research

Waived: the registered `BACKLOG-ZERO-MIGRATION` class and completed batches 01–09 define the exact
fixed-population, body-preserving handoff mechanism. This batch follows that precedent and changes no
package, API, policy, workflow, hook, skill, topology, or product documentation path.

## Architecture Review

### Affected Scope

- Three fixed-population Task records: ARCH-047, ARCH-048, and ARCH-049.
- Four package SPEC/README carrier documents whose exact links must follow the archived Task paths.
- Their exact existing GitHub owner issues and one append-only canonical handoff comment per issue.
- Paired DOCS-039 spec/Task and the required loop-run ledgers.

No package/app source, API/contract, policy/gate document, skill/workflow/hook/topology, or
product/user documentation is in scope. The four package contract carriers are documentation-only
path rekeys required to keep the archived Task links valid. No issue metadata is edited or closed.

### Alternatives Considered

1. Leave all three Tasks active. **Pro:** no document edits. **Con:** GitHub and the repository
   remain competing queues.
2. Implement the three architecture outcomes here. **Pro:** resolves the underlying causes.
   **Con:** this crosses the delegated
   documentation-only boundary and combines three independent implementation causes.
3. Close the existing issues. **Pro:** removes visible queue entries. **Con:** the issues are the
   canonical OPEN owners and closing them would destroy valid implementation work.
4. Append exact handoffs, rekey the four package contract carriers, and terminalize the duplicate
   Tasks. **Pro:** preserves valid premises, ownership, and re-creation-on-pickup while removing
   stale local queue entries without changing contracts or behavior. **Con:** it requires four
   documentation carrier edits and fresh direct approval outside the earlier class boundary.

### Decision

Choose alternative 4. Each Task becomes `skipped` with its exact canonical issue comment in
`returned_to_issue`; each body remains unchanged apart from terminal frontmatter, and each file moves
to `completed/` in the closing commit. The four package SPEC/README carriers rekey only their links
from the root Task paths to `completed/`. The implementation issues remain OPEN and are not modified
beyond the append-only handoff comments. Because this carrier-safe extension is outside the prior
delegated class boundary, it requires a fresh DIRECT user approval.

### Architecture Review Checklist

- [x] Affected scope lists the three Tasks, four carriers, paired records, and exclusions.
- [x] Three alternatives plus the chosen handoff are documented.
- [x] Sibling scan completed: current blobs, issue owners, PRs, branches, worktrees, assignees, and
      active loops were checked for all three units.
- [x] Current premise, ownership, branch, PR, and worktree checks were performed.

## Fallback & Degradation Declaration

None. If any owner or blob check fails, leave the Task active and return to recommendation review;
do not partially terminalize the batch.

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `9c43eee8cba55b60401ca5a49d085b900eafd6bd`.

Limits: 3 fixed-population units and no more than 15 final paths. The final path set is the three
Task records, four package documentation carriers, the paired DOCS-039 spec/Task, and the three
loop ledgers (12 paths). No source/API/policy/workflow/hook/skill/topology/product path is permitted.

Population/current Task blobs:

```text
.agents/tasks/ARCH-047-stable-root-anchored-project-mutation.md @ 1a444e20d60e59d063d35f37860adc4664f9b77d
.agents/tasks/ARCH-048-canonical-project-root-binding.md @ 926560cf6b9336225368f4a60b258231d539a5b5
.agents/tasks/ARCH-049-cross-platform-stable-external-payload-replay.md @ eaa7f2200f3e8a0f0496f53cb57ae8bdec639c27
```

| Unit     | Exact owner/evidence                                                                                        | Disposition                             |
| -------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| ARCH-047 | OPEN, unassigned issue #2151; handoff https://github.com/woojubb/robota/issues/2151#issuecomment-5459345438 | Preserve body; skip and return to issue |
| ARCH-048 | OPEN, unassigned issue #2152; handoff https://github.com/woojubb/robota/issues/2152#issuecomment-5459345529 | Preserve body; skip and return to issue |
| ARCH-049 | OPEN, unassigned issue #2153; handoff https://github.com/woojubb/robota/issues/2153#issuecomment-5459345619 | Preserve body; skip and return to issue |

Carrier rekeys (documentation-only, exact path substitution):

```text
packages/agent-framework/docs/SPEC.md
packages/agent-cli/docs/SPEC.md
packages/agent-session/docs/SPEC.md
packages/agent-session/README.md
```

All three issues have no competing PR, branch, worktree, assignee, or active loop. Their premises
remain valid on `develop` and their current blobs equal the fixed-population blobs. The exact issue
comments are append-only canonical handoffs; no issue is edited, closed, or assigned.

## Solution

1. Obtain independent recommendation review and fresh DIRECT approval against this immutable
   three-unit/12-path manifest; the prior class approval does not cover package carriers.
2. Revalidate exact blobs, current premises, issue state, and handoff URLs.
3. Rekey only the four carrier links from root Task paths to completed Task paths.
4. Move the three Tasks to `completed/`, set `status: skipped` and `completed: 2026-08-29`, and
   add exact `returned_to_issue` frontmatter links in one terminalization commit.
5. Run GATE-IMPLEMENT, GATE-VERIFY, and GATE-COMPLETE, then run focused and full harness checks.

## Completion Criteria

- [ ] TC-01: the manifest remains exactly three units, twelve final paths, exact blobs, owner issues,
      handoffs, and excluded scope.
- [ ] TC-02: all three Tasks are body-preserving `skipped` records archived atomically with exact
      `returned_to_issue` links.
- [ ] TC-03: lifecycle, citation, delegation, carrier, and no-growth scans pass with no excluded path changed.
- [ ] TC-04: focused checks, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` exit 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                          | Notes                                                     |
| ----- | --------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git blob/path inventory and issue readback               | Skip: fixed manifest is the observable result.            |
| TC-02 | Agreement / lifecycle | Normalized body diff plus archival/citation scans        | Skip: exact handoff and path evidence prove preservation. |
| TC-03 | Agreement / exclusion | Changed-path classification and standing-delegation scan | Skip: no runtime behavior exists.                         |
| TC-04 | Agreement / CI        | Focused scans and full harness mirror                    | Skip: existing gates verify docs-only output.             |

## Tasks

`.agents/tasks/DOCS-039-terminalize-backlog-zero-migration-batch-10.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — All 4 checklist items are `[x]`: 3 checklist item(s), 4 required
  **Required action:** complete the checklist
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"
  **Required action:** add the Sibling scan item
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: alternative(s) 1, 2, 3, 4 lack a Pro or a Con
  **Required action:** give every alternative a Pro and a Con

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [GATE-WRITE GUARDIAN], [FINDING DEPTH REVIEW]
  **Required action:** a first GATE-WRITE run expects an empty log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

**Judged by:** `backlog-gate-guard`, against `.agents/specs/gate-catalogue.md` § GATE-WRITE. The
mechanical floor was run with `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc
.agents/spec-docs/backlog/DOCS-039-terminalize-backlog-zero-migration-batch-10.md --date 2026-08-29`.

**Mechanical criteria:**

- GATE-WRITE — File begins with `---` YAML frontmatter block — PASS: file begins with a `---` frontmatter block — `mechanical`
- GATE-WRITE — `status: draft` present in frontmatter — PASS: `status: draft` — `mechanical`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list — PASS: `type: INFRA` is one of 11 allowed values — `mechanical`
- GATE-WRITE — `tags:` field present in frontmatter — PASS: `tags:` present with 2 values — `mechanical`
- GATE-WRITE — Does not contain `TBD`, `TODO`, or vague single-sentence descriptions — PASS: `## Problem` has no TBD/TODO and is 736 characters across 4 sentences — `mechanical`
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present — PASS: section present — `mechanical`
- GATE-WRITE — Prior Art section is substantiated — PASS: `scan-spec-research` reports the section explicitly waived with a reason — `mechanical`
- GATE-WRITE — Explicit `Waived: <reason>` line when research is waived — PASS: explicit waiver is present — `mechanical`
- GATE-WRITE — All 4 Architecture Review checklist items are `[x]` — PASS: 4/4 checked — `mechanical`
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or explicit `N/A` — PASS: checked sibling scan records completion evidence — `mechanical`
- GATE-WRITE — Alternatives Considered has at least 2 entries with Pro and Con — PASS: 4 numbered alternatives each have Pro and Con — `mechanical`
- GATE-WRITE — Every item has a `TC-N` prefix — PASS: 4 criteria are all `TC-NN` prefixed — `mechanical`
- GATE-WRITE — No criterion uses banned vague phrases — PASS: none of `works correctly`, `no errors`, `implemented`, or `displays correctly` appears — `mechanical`
- GATE-WRITE — `## Test Plan` section present — PASS: section present — `mechanical`
- GATE-WRITE — One Test Plan row exists for each `TC-N` — PASS: 4 rows match 4 criteria — `mechanical`
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool/Approach — PASS: 4 rows have both and no TBD — `mechanical`
- GATE-WRITE — Manual-tool rows have explanatory Notes — PASS: 0 manual rows; all rows have Notes — `mechanical`
- GATE-WRITE — `## Tasks` section present with placeholder — PASS: section references the paired Task path — `mechanical`
- GATE-WRITE — `## Evidence Log` section present and valid for this run — PASS: section exists and prior failed attempts are retained as history — `mechanical`
- GATE-WRITE — No `## Status` or `## Classification` sections in body — PASS: neither prohibited body section is present — `mechanical`

**Semantic criteria:**

- GATE-WRITE — Problem contains a concrete symptom — PASS: it names the duplicate durable queue and the exact `rg -n 'ARCH-04[789]' ...` observation — `semantic`
- GATE-WRITE — Problem contains a reproduction condition — PASS: it states the OPEN-issue/root-Task retention and no-rekey archive conditions and their stale-queue/broken-link results — `semantic`
- GATE-WRITE — Prior-art findings feed Alternatives/Decision — PASS: the registered migration class and batches 01–09 constrain the body-preserving handoff, while the class/carrier boundary motivates alternative 4 — `semantic`
- GATE-WRITE — Decision references the trade-off driving the choice — PASS: it balances premise/ownership preservation and duplicate-queue removal against four carrier edits and fresh DIRECT approval — `semantic`
- GATE-WRITE — New-surface placement (conditional) — PASS/N/A: no package, app, presentation/interface, layer, or product-family surface is introduced — `semantic`
- GATE-WRITE — At least one criterion covers each distinct feature or sub-item — PASS: TC-01 through TC-04 cover manifest, three handoffs/body preservation, scans/carriers, and full verification — `semantic`
- GATE-WRITE — Each criterion uses Command or Observable behavior form — PASS: all criteria state observable manifest/body/scan/exit-code outcomes and map to Test Plan rows — `semantic`

GATE VERDICT: PASS

### [FINDING DEPTH REVIEW] — ✅ PASS | 2026-08-29

- `DEPTH: FOUNDATIONAL` — the duplicate queue is the parent #2404 lifetime/ownership invariant;
  the four carrier links additionally expose structural coupling to mutable Task paths. DOCS-039 is
  finite containment and leaves the three implementation issues OPEN.
- `ACTIONABLE FINDINGS: 0`.

### [RECOMMENDATION REVIEW ROUND 1] — ✅ ENDORSE | 2026-08-29

- Exact scope is three fixed-population units, four package-document carriers, the paired DOCS-039
  records, and three loop ledgers: twelve paths, within the class six-unit/15-path ceiling.
- ARCH-047/048/049 blobs equal the fixed population and current `develop`; issues #2151/#2152/#2153
  are OPEN, unassigned, and have exact append-only canonical handoffs. No competing PR, branch,
  worktree, assignee, or loop exists.
- Carrier changes are exact root-to-`completed/` link rekeys and contain no source/API/policy or
  product behavior change. The prior class boundary is explicitly recognized, so fresh DIRECT user
  approval is required before implementation.
- `ACTIONABLE FINDINGS: 0`.

**Independent reviewer verdict:** `REVIEW VERDICT: ENDORSE`

## User Execution Test Scenarios

Not applicable: this is a documentation-only queue handoff with no user-facing runtime behavior.
