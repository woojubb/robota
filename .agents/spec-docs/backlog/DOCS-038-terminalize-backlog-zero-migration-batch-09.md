---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-038: Terminalize backlog-zero migration batch 09

## Problem

Three `critical/high + now` records in the fixed 2026-08-28 population still form a second durable
queue beside GitHub even though their implementation outcomes remain unfinished. SEC-016 shipped
eleven of twelve criteria but never demonstrated the required CLI product scenario. SECURITY-001
still has all eight end-to-end workspace-trust criteria unchecked after its original issue was closed
on Task registration. STRUCT-011 delivered most of a package rename but left one live import of the
removed package name and its final verification incomplete.

The base is `origin/develop` at `cf5c83e627d88958497ea8c04633502d837f4452`. Each governed Task
blob equals the fixed-population blob. There is no open PR, matching current implementation branch,
extra worktree, assignee, or open loop owning any unit. Marking the records done would overclaim their
state; leaving them active would retain competing queues.

Issue #2404 owns prevention of future duplicate durable queues. DOCS-038 is finite containment only.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already define the mechanism:
fixed-manifest current-truth validation, an exact open GitHub owner and canonical handoff, and
body-preserving terminalization. This batch applies that internal lifecycle mechanism and changes no
package, API, product, policy, workflow, hook, skill, or topology.

## Architecture Review

### Affected Scope

- SEC-016 Task lifecycle move, its stale active plan rejection, and a cardinality-preserving
  standing-delegation baseline key move from `active/` to `rejected/`.
- SECURITY-001 Task lifecycle move to the exact open successor created for its still-unfinished
  end-to-end outcome.
- STRUCT-011 Task lifecycle move and its stale approved plan rejection.
- The paired DOCS-038 Task/spec and two required closed loop ledgers.
- One control issue, one successor issue, three canonical handoff comments, and one append-only note
  linking the closed original SECURITY-001 report to its successor.

No package/app source, API/contract, package/product/user documentation, policy/gate document,
skill/workflow/hook/topology, or product-direction change is in scope. The baseline edit is an exact
no-growth lifecycle rekey, not a policy change.

### Alternatives Considered

1. Leave the records active. **Pro:** no lifecycle edit is needed. **Con:** GitHub and the repository
   remain two competing durable queues for the same outcomes.
2. Implement the three outcomes here. **Pro:** the underlying product work would be resolved.
   **Con:** it crosses the documentation-only delegated boundary and combines unrelated package and
   security changes.
3. Reopen closed issue #2018. **Pro:** the original SECURITY-001 owner would become active again.
   **Con:** reopening mutates issue metadata before batch completion, which the delegated class
   explicitly does not authorize.
4. Return each record to an exact open owner using append-only remote evidence. **Pro:** delivered
   and unfinished truth, urgency, and the delegated boundary are all preserved. **Con:** the repo
   records become historical pointers and the product work remains intentionally open in GitHub.

### Decision

Choose alternative 4.

- SEC-016 becomes `skipped` after exact handoff
  https://github.com/woojubb/robota/issues/2225#issuecomment-5458301445. The implementation leaf
  delivered TC-01..10 and TC-12; issue #2225 owns the sole unmet TC-11 product-surface demonstration.
  Its active plan becomes `rejected`, and the frozen standing-delegation key follows that lifecycle
  move without changing set cardinality.
- SECURITY-001 becomes `skipped` after exact handoff
  https://github.com/woojubb/robota/issues/2465#issuecomment-5458301582. Issue #2465 is the unique
  open successor for all eight unchecked trust-boundary criteria. Closed issue #2018 remains an
  immutable historical report and links forward by append-only comment.
- STRUCT-011 becomes `skipped` after exact handoff
  https://github.com/woojubb/robota/issues/2198#issuecomment-5458301707. Issue #2198 is open/reopened
  and owns the remaining live import at `packages/agent-cli/scripts/record-goal-cassette.mts:15` plus
  final verification. Its approved plan becomes `rejected` because GitHub is now the sole queue.

ARCH-047, ARCH-048, and ARCH-049 are valid urgent residuals but require excluded package-document
carrier edits. RULE-015 requires excluded rule/policy carriers. They are not silently included.

### Architecture Review Checklist

- [x] Affected scope listed — ten internal lifecycle/ledger/baseline paths only.
- [x] Sibling scan completed — all critical/high-now population records, blobs, current premises,
      issues, branches, worktrees, assignees, loops, citations, baselines, and carriers checked.
- [x] At least two alternatives considered.
- [x] Decision rationale documented.

## Fallback & Degradation Declaration

None. The operation is an atomic lifecycle handoff; failure leaves the records active and does not
change package behavior.

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `cf5c83e627d88958497ea8c04633502d837f4452`.

Limits: 3 units; 10 final tracked paths. Each governed Task blob is identical at population, base,
HEAD, and worktree. No package source, API, policy, product documentation, workflow, hook, skill, or
topology path is permitted.

| Unit         | Governed original path and blob OID                                                                                                            | Exact current owner and evidence                                                                                                                 | Disposition                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| SEC-016      | `.agents/tasks/SEC-016-per-event-hook-enforcement-policy.md` @ `57c1a87e77de6a0f58beb23e7f409f3b470f7b25`                                      | OPEN/unassigned issue #2225; exact handoff https://github.com/woojubb/robota/issues/2225#issuecomment-5458301445; TC-11 alone remains unchecked. | Preserve Task/spec bodies; Task skipped, plan rejected, baseline key active→rejected. Issue #2093 remains historical context. |
| SECURITY-001 | `.agents/tasks/SECURITY-001-untrusted-workspace-configuration-crosses-the-user-trust-boundary.md` @ `ebd76904511da6d18815d91fa67ab24b5b276017` | OPEN/unassigned successor #2465; exact handoff https://github.com/woojubb/robota/issues/2465#issuecomment-5458301582; all eight criteria open.   | Preserve Task body and archive skipped. Closed #2018 remains historical and carries only an append-only successor link.       |
| STRUCT-011   | `.agents/tasks/STRUCT-011-provider-aggregator-carries-the-prefix-of-what-it-aggregates.md` @ `04317a761813dd04a66d5b8bdd9bb1eb127fcbe2`        | OPEN/unassigned issue #2198; exact handoff https://github.com/woojubb/robota/issues/2198#issuecomment-5458301707; stale live import confirmed.   | Preserve Task/spec bodies; Task skipped and approved plan rejected. Product/package repair stays with issue #2198.            |

Plan blobs are fixed and current at `034fa55dd793b8b01871cfb45534a0895db8302c` for SEC-016 and
`ff445f698f9d315fb9d0eb489cb3f53be5f3cc7f` for STRUCT-011. The standing-delegation baseline is
`bbe76bd5d457ec5c496e4b82aa65373f79dc24d6` at the fixed-population object, but later authorized
lifecycle rekeys make its base/HEAD/worktree preimage
`9988892ae31e368fd2ffc43ee937b826e9e1d464`. Replacing only
`active/SEC-016-per-event-hook-enforcement-policy.md` with the same basename under `rejected/`
produces expected postimage `7704d8bbf977e90bdf7fe032e02129e1cc4ed754`: cardinality remains
218, the source key count changes 1→0, the destination key 0→1, and all other entries and order stay
unchanged.

Live ownership check: no open PR, current matching implementation branch, extra worktree, assignee,
or open loop owns any unit. The remote `origin/docs/issue-2018-to-task` branch is stale registration
residue: it is hundreds of commits behind develop, has no PR, and its sole unique commit predates the
current SECURITY-001 Task blob and dependency state.

Control issue #2464 uniquely carries `backlog-zero:DOCS-038:2c875dd3`. Successor issue #2465 uniquely
carries its SECURITY-001 residual marker. Issues #2464, #2465, #2225, and #2198 are OPEN and
unassigned. All three canonical handoff comments are exact and unmodified (`created_at == updated_at`).

Any governed blob, exact owner, current premise, disposition, or path-set change excludes that unit
and requires a fresh recommendation and class approval.

## Solution

1. Freeze the exact three-unit/ten-path manifest and preserve remote readback evidence.
2. Obtain independent depth and recommendation review of urgency, ownership, current truth, baseline
   cardinality, and class boundary; record class approval only at zero actionable findings.
3. Create the paired Task and subject-bound not-applicable scenario checkpoint before implementation.
4. Apply only the three Task moves, two plan rejections, and one exact baseline rekey.
5. Verify normalized body preservation, exact paths/blobs/issues/comments, lifecycle/folder/citation/
   delegation/baseline/loop gates, current premises, full harness scan, and the CI mirror.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-038-terminalize-backlog-zero-migration-batch-09.md`
- `.agents/spec-docs/rejected/SEC-016-per-event-hook-enforcement-policy.md`
- `.agents/spec-docs/rejected/STRUCT-011-provider-aggregator-carries-the-prefix-of-what-it-aggregates.md`
- `.agents/tasks/completed/DOCS-038-terminalize-backlog-zero-migration-batch-09.md`
- `.agents/tasks/completed/SEC-016-per-event-hook-enforcement-policy.md`
- `.agents/tasks/completed/SECURITY-001-untrusted-workspace-configuration-crosses-the-user-trust-boundary.md`
- `.agents/tasks/completed/STRUCT-011-provider-aggregator-carries-the-prefix-of-what-it-aggregates.md`
- `scripts/harness/standing-delegation-baseline.json`

## Completion Criteria

- [ ] TC-01: the approved manifest remains exactly three fixed-population units, ten final tracked
      paths, three exact skipped dispositions, two exact plan rejections, and one no-growth baseline
      rekey, with no excluded path.
- [ ] TC-02: control/owner issues and three canonical handoffs read back exactly as OPEN, unassigned,
      unique where marked, and unmodified; each skipped Task cites its exact owner comment.
- [ ] TC-03: all three Task bodies and both plan bodies remain byte-identical after normalization,
      with only approved lifecycle frontmatter/path changes.
- [ ] TC-04: the standing-delegation baseline changes only the SEC-016 folder prefix and preserves
      its sorted set and cardinality; no package/app/API/policy/product/workflow/topology path changes.
- [ ] TC-05: the exact final path set is ten and focused lifecycle/current-premise checks plus
      `pnpm harness:scan` and `pnpm harness:verify-like-ci` all exit 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                  | Notes                                                                       |
| ----- | --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git blob/path inventory and fixed-population comparison          | Test skipped: evidence audit observes a fixed documentation manifest.       |
| TC-02 | Agreement / remote    | Exact GitHub issue/comment marker, owner, and timestamp readback | Test skipped: append-only remote state is control-plane evidence.           |
| TC-03 | Agreement / lifecycle | Normalized Task/spec body comparison plus placement scanners     | Test skipped: Git bytes and lifecycle scanners directly prove preservation. |
| TC-04 | Agreement / baseline  | JSON set/cardinality comparison and excluded-path classification | Test skipped: exact before/after data and path inventory are the result.    |
| TC-05 | Agreement / CI        | Focused scanners/tests, full harness scan, and CI mirror         | Test skipped: no new runtime behavior; existing gates verify the result.    |

## Tasks

The exact Task `.agents/tasks/DOCS-038-terminalize-backlog-zero-migration-batch-09.md` is created only
after GATE-APPROVAL passes, before GATE-IMPLEMENT.

## User Execution Test Scenarios

Not applicable. This work changes internal lifecycle evidence, one frozen lifecycle baseline key, and
remote queue ownership only. It introduces no runnable user-facing behavior.

## Remote Grounding Evidence

- Base, HEAD, and worktree blobs equal the fixed-population blobs for all three Tasks and both plans.
  The baseline is deliberately distinguished: population blob `bbe76bd5...`, current preimage
  `9988892...`, and exact one-key expected postimage `7704d8bb...`, with cardinality 218 throughout
  the current rekey.
- Issues #2464, #2465, #2225, and #2198 are OPEN and unassigned. Control/successor markers are unique.
- Canonical comments #5458301445, #5458301582, and #5458301707 carry exact Task paths/blobs and
  current residuals, and each has `created_at == updated_at`.
- Closed original issue #2018 remains closed and now carries only append-only successor note
  #5458301853; no issue metadata was changed.
- Current source confirms the SEC-016 TC-11 gap, SECURITY-001's eight unchecked criteria despite
  trust-service primitives, and STRUCT-011's stale live import. No competing PR/worktree/assignee/
  loop/current branch exists.
- `ACTIONABLE FINDINGS: 0`.

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: alternative(s) 1, 2, 3, 4 lack a Pro or a Con
  **Required action:** give every alternative a Pro and a Con
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [REMOTE-GROUNDING]
  **Required action:** a first GATE-WRITE run expects an empty log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [REMOTE-GROUNDING]
  **Required action:** a first GATE-WRITE run expects an empty log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` is present and matches the entry-gate input state.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags: [docs, migration]` is present with two values.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): the Problem names SEC-016's missing CLI scenario, SECURITY-001's eight unchecked criteria, and STRUCT-011's live stale import.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): the pinned `origin/develop` base and the current fixed-population Task states identify the exact base and records where each residual reproduces.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO and contains 1,013 characters across 10 sentences.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section explicitly waived with RULE-017 and the registered class named as the governing internal mechanism.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : the section begins with an explicit `Waived:` reason rather than a bare waiver.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the named RULE-017/class mechanism feeds alternative 4 and the exact-owner, body-preserving terminalization decision.
- GATE-WRITE — All 4 checklist items are `[x]`: all four Architecture Review Checklist items are checked.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked item records completed scans of blobs, premises, issues, branches, worktrees, assignees, loops, citations, baselines, and carriers.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: four numbered alternatives are present and each has explicit Pro and Con text.
- GATE-WRITE — Decision references the trade-off that drove the choice: the Decision chooses alternative 4 to preserve delivered/unfinished truth and urgency without crossing the delegated documentation-only boundary.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — the Affected Scope explicitly introduces no package, app, presentation/interface surface, or layer/product-family boundary.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: five criteria are present and all use `TC-NN:` prefixes.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 through TC-03 cover all three lifecycle handoffs and owner/body preservation, TC-04 covers the baseline rekey, and TC-05 covers final path and gate verification.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): every TC states an observable manifest, remote readback, byte-preservation, cardinality, path-set, or exit-code result.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the four banned phrases appears in Completion Criteria.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): five Test Plan rows match five Completion Criteria (`TC-01` through `TC-05`) exactly.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all five rows have non-empty Test Type and Tool/Approach cells and no TBD.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: zero rows use `manual`; every row nevertheless carries a non-empty Notes explanation.
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` is present and names the deferred exact Task path and creation point.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` is present with only three GATE-WRITE entries and none from a later gate; the empty-log condition is N/A on this retry.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): neither prohibited body section is present.

### [FINDING DEPTH REVIEW] — ✅ PASS | 2026-08-29

- `DEPTH: FOUNDATIONAL` — fixed-population Tasks/specs can survive beside exact GitHub owners because
  no lifetime invariant terminalizes the repository record on durable handoff. Issue #2404 already
  owns that prevention mechanism; this delegated class performs finite containment without hiding it.
- All three dispositions preserve unfinished product outcomes in #2225, #2465, and #2198.
- `ACTIONABLE FINDINGS: 0`.

### [RECOMMENDATION REVIEW ROUND 1] — 🔴 REVISE | 2026-08-29

- High — baseline preimage: the draft conflated fixed-population baseline blob
  `bbe76bd5d457ec5c496e4b82aa65373f79dc24d6` with current base/HEAD/worktree blob
  `9988892ae31e368fd2ffc43ee937b826e9e1d464` after intervening authorized lifecycle rekeys.
- Correction: the manifest now distinguishes population, current preimage, and exact one-key
  postimage `7704d8bbf977e90bdf7fe032e02129e1cc4ed754`; cardinality remains 218, source
  `active/SEC-016...` changes 1→0, destination `rejected/SEC-016...` changes 0→1, and every other
  entry and order remains unchanged.
- Unit selection, ownership, current premises, urgency, ten-path projection, and excluded-scope
  boundary otherwise passed. `ACTIONABLE FINDINGS: 1`.

**Independent reviewer verdict:** `REVIEW VERDICT: REVISE`

### [RECOMMENDATION REVIEW ROUND 2] — ✅ ENDORSE | 2026-08-29

- The corrected baseline chain is exact: population `bbe76bd5...`, current preimage `9988892...`,
  projected postimage `7704d8bb...`, cardinality 218→218, source 1→0, destination 0→1, with every
  other entry and order identical.
- Task/spec blobs, current residual premises, exact open/unassigned owners, unmodified comments,
  unique markers, urgency order, absence of competing ownership, ten paths, and the class exclusion
  boundary all pass against `origin/develop@cf5c83e627d88958497ea8c04633502d837f4452`.
- `ACTIONABLE FINDINGS: 0`.

**Independent reviewer verdict:** `REVIEW VERDICT: ENDORSE`
