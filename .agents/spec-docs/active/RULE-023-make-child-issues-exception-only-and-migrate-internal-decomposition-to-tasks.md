---
status: in-progress
type: RULE
tags: [github, backlog, governance]
lane: L2
---

# RULE-023: Make child Issues exception-only and migrate internal decomposition to Tasks

## Problem

The repository currently assigns the same internal decomposition to two queues. The opening of
`.agents/rules/backlog-execution.md` and `.agents/tasks/README.md` says one Issue remains the external
problem while internal causes become Tasks, but the same rule and `issue-to-backlog` later require a
broad parent to create child Issues, close, and leave those children as the open queue. Following both
instructions makes Issue count grow merely because implementation was planned, duplicates priority and
completion state, and leaves no single owner for the current problem summary.

The contradiction has already produced a large live hierarchy. The 2026-08-30 baseline found 281 open
Issues, including 78 open native child Issues: 55 descendants of issue #2079, 17 under MCP parent
issue #1985 and MCP parent issue #1986, and 6 under throughput parent issue #2512. It also produced a false conversion
link: delivered `RULE-021` records cite package-boundary issue #2490, causing the live triage audit to classify that
unrelated Issue as malformed. These measurements are discovery evidence only and must be re-derived
from current GitHub state before every mutation wave.

## Prior Art Research

### References consulted

- [GitHub Docs — Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues):
  sub-issues are first-class Issues with their own descriptions, assignees, labels, projects, and
  milestones; existing Issues can be attached or detached without recreation.
- [GitHub Docs — About tasklists](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists):
  smaller work may remain inside one Issue, while an item should become an Issue when it needs further
  tracking or discussion.
- [GitHub Docs — Editing an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue)
  and [Tracking changes in a comment](https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment):
  descriptions are mutable with edit history, while comments retain a separate chronological record.
- [GitHub Docs — Adding and managing issue fields](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-and-managing-issue-fields):
  duplicate fields tracking the same concept cause confusion and should migrate to one source of truth.
- [Linear Docs — Parent and sub-issues](https://linear.app/docs/parent-and-sub-issues) and
  [Edit issues](https://linear.app/docs/editing-issues): sub-issues fit work needing separate ownership
  and lifecycle; they can be detached or promoted, while description history and old identities remain
  recoverable.
- [Linear Docs — Linear-to-Linear import](https://linear.app/docs/linear-to-linear) and
  [Exporting data](https://linear.app/docs/exporting-data): supported migrations preserve descriptions,
  comments, workflow state, sub-issues, relationships, and parent identity.
- [Jira Cloud Docs — Create a work item and a subtask](https://support.atlassian.com/jira-software-cloud/docs/create-a-work-item-and-a-subtask/)
  and [Work item activity](https://support.atlassian.com/jira-software-cloud/docs/what-are-the-different-types-of-activity-on-an-issue/):
  child work exists for separately assigned/tracked aspects, may be promoted to standalone work, inherits
  parent security, and split operations do not automatically preserve every comment/history/link.

### Observed common behavior

The products converge on two decomposition levels. Lightweight steps remain in the current Issue;
separate work items are warranted when a unit needs independent assignment, status, priority, discussion,
workflow, visibility policy, or completion. GitHub and Linear make hierarchy reversible, and Jira permits
promoting a child to standalone work rather than treating hierarchy as permanent identity.

GitHub and Linear use sub-issues more broadly than this proposal because their sub-issue is itself the
granular execution record. Robota already has a checked-in Task/spec layer that owns executable cause
decomposition, priority after conversion, acceptance criteria, and lifecycle. Repeating that graph in
GitHub creates the duplicate-source-of-truth risk GitHub warns about; the cross-product threshold still
supports a separate Issue when an independent external lifecycle exists.

The documentation does not mandate the phrase “body is the canonical current snapshot.” It consistently
provides a mutable, recoverable description plus separate comment/activity/history streams. Body-as-current
state and comments-as-chronology is therefore a supported Robota convention, not a claim about a vendor
requirement. Migration guidance likewise favors preserving identity, history, relationships, and redirects
instead of replacing records or copying incomplete history.

### Constraints for Robota

- A retained child must name what external capability would be lost if it became only a Task: independent
  discussion/approval, priority, accountable owner, user-visible completion, terminal disposition, or an
  actually enforced visibility/trust boundary.
- Different packages, files, tests, phases, or subagent assignments justify separate Tasks but do not alone
  justify separate external Issues.
- A GitHub parent relation does not create confidentiality. A security/publicity exception must name the
  permissions model that actually enforces it.
- The body may own the current parent/Task map because its revisions remain auditable. Comments remain
  chronological evidence and are not mandatory solely to mirror a mechanical absorption.
- Historical URLs, comments, labels, assignees, dependencies, Task markers, and linked PRs must survive.

### Evidence-based recommendation

Adopt **one GitHub Issue → one or more Tasks** as the default and require an explicit external-lifecycle
test for every child Issue. Preserve current state in the body and use comments for material discoveries,
discussion, decisions, and dated context. Migrate through a complete before-state manifest, operate on
existing records, pilot one bounded branch, apply read-back after every write, and hold any unresolved
Task identity, active owner, security/data-correctness concern, or history gap for owner review.

## Architecture Review

### Affected Scope

Work unit A — policy and enforcement:

- `.agents/rules/backlog-execution.md` — Issue/Task authority and body/comment ownership SSOT.
- `.agents/skills/issue-to-backlog/SKILL.md` — conversion and exception-only child procedure.
- `.agents/skills/github-issue-triage/SKILL.md` — live hierarchy audit and retained-child evidence.
- `.agents/tasks/README.md` — Task relationship and lifecycle guidance.
- `scripts/harness/github-issue-triage.mjs` — read-only native-parent audit.
- `scripts/harness/__tests__/github-issue-triage.test.mjs` — fail-closed hierarchy and policy-owner tests.
- `.agents/tasks/completed/RULE-021-close-parent-on-decomposition.md` and its paired spec — remove the false issue #2490
  source and terminalize the superseded opposite policy.
- RULE-023 Task/spec and generated loop-run ledgers.

Work unit B — governed migration after work unit A reaches `develop`:

- One durable, approved migration manifest paired to RULE-023.
- GitHub Issue bodies, native parent relations, labels, states, and comments only where the approved
  row requires them.
- Existing or newly governed Task/spec records that become canonical execution owners.
- RULE-023 Task/spec lifecycle evidence and generated loop-run ledgers.

No package/app source, public API, workspace dependency direction, runtime behavior, or product surface
changes. GitHub history and comments are never deleted.

### Alternatives Considered

1. **Keep the current parent-to-child Issue decomposition and close every parent.**
   - Pro: every implementation cause receives a visible external record.
   - Con: planning creates queue entries, Issue and Task priorities duplicate each other, and externally
     meaningless implementation steps become indistinguishable from independently discussable problems.
2. **Use one Issue as the durable problem record, put internal causes in Tasks, and retain child Issues
   only for an independent external lifecycle.**
   - Pro: restores one owner per fact, stops decomposition-driven queue growth, and preserves distinct
     discussion, priority, ownership, security, or terminal decisions where they are genuinely needed.
   - Con: requires a measured historical migration and an explicit exception reason on retained children.
3. **Forbid child Issues entirely and absorb every hierarchy into Tasks.**
   - Pro: produces the smallest Issue count and simplest structural rule.
   - Con: hides separately prioritized security/trust defects and removes external discussion and terminal
     signals that can truthfully diverge from their parent.

### Decision

Choose alternative 2. The GitHub Issue body owns the canonical current external problem, constraints,
and current related-record map. Comments own discoveries, discussion, dated decisions, and chronological
evidence; a mechanical absorption does not require a narrative comment merely to restate the body/state
change. Machine-readable conversion receipts and exact Task-marker comments remain mandatory append-only
structural records where the conversion protocol requires them. Tasks/specs own executable cause
decomposition, execution priority, and verification.

A child Issue is created or retained only when its body names observable evidence of a distinct **external**
lifecycle: a separate claimant/audience or stakeholder discussion/approval route, a separately accountable
external owner, an actually enforced visibility/security boundary, an independent release/user-observable
outcome, or an externally meaningful terminal disposition. A different package, file, test, implementation
phase, Task priority, agent assignment, or independently verifiable Task outcome is insufficient by itself.
Issue P labels order unconverted intake only and cannot become a permanent RETAIN reason after Task conversion.

This boundary composes with PROC-017 rather than replacing it. PROC-017 may combine conversion and
implementation only for its already-enforced `child-causes=0`, single-owner, single-cause enhancement
case. An Issue requiring several Tasks/AGREEMENT ownership or an independent child lifecycle is ineligible
for that combined route. Work unit A must preserve PROC-017 conversion evidence and plan-order enforcement.

Delivery is deliberately sequenced into two named work units because historical mutation before the
new policy lands would let the old policy recreate the shape during migration:

**Continuation artifacts:** `.agents/evidence/RULE-023-child-issue-migration-manifest.json`, `.agents/spec-docs/active/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md`, `.agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md`

1. **Work unit A — policy and enforcement.** Land the consistent rule/skills, a read-only native-parent
   audit that refuses an open child with no non-empty `## Independent external lifecycle` body section,
   and the RULE-021 reconciliation for issue #2490. The audit reports an exact examined denominator and never
   guesses the adequacy of a supplied reason; semantic adequacy requires a dated `RETAIN` verdict from a
   reviewer other than the author or migration actor, recorded as
   `Semantic review: @<github-login> on YYYY-MM-DD — RETAIN` in the lifecycle section.
2. **Work unit B — manifest and migration.** Rebase on the merged policy, freeze a complete current
   manifest, independently cross-review it, pilot one bounded hierarchy, then execute disjoint waves.
   An `ABSORB` row may close only after its canonical parent body and Task owner are readable. A `RETAIN`
   row stays open only with its external-lifecycle reason in the body. `OWNER_REVIEW` does not mutate.

Canonical-parent state is decided once per complete parent group, never independently by child rows.
Reopen a closed parent once when that group contains unfinished `ABSORB` work and no other truthful open
Issue owns the external problem. Keep the parent closed when every unfinished descendant has a valid
independent `RETAIN` lifecycle or every descendant is resolved. Update the parent body's complete
Issue/Task map once per group. An open parent converted to an AGREEMENT Task is not an unconverted
executable queue candidate because Task priority/urgency owns execution after conversion.

The terminal transition is explicit and preserves delivery truth:

| Disposition        | Required transition                                                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ABSORB`           | Verify the group-level parent body and exact Task owner, then close the child with GitHub state reason `NOT_PLANNED`; work continues under the canonical parent/Task and is not claimed delivered. |
| `ALREADY_RESOLVED` | Verify a delivering `develop` commit, completed Task, or equivalent current-tree evidence, then close the child with state reason `COMPLETED`.                                                     |
| `RETAIN`           | Keep the child open and write its observable reason plus independent reviewer identity/date/`RETAIN` verdict into `## Independent external lifecycle` in the body.                                 |
| `OWNER_REVIEW`     | Perform no body, relationship, label, state, Task-marker, or dependency mutation until the named uncertainty is resolved.                                                                          |

Any child with an assignee, active owner, open Task, open PR, or live branch/worktree is forced to
`OWNER_REVIEW`. It may become `ALREADY_RESOLVED` after delivery, or undergo an identity migration only
after its owner explicitly approves and every source Task/marker/PR link is preserved and read back.
An approved manifest may create a new canonical migration Task as an `ABSORB` prerequisite without that
new Task's mere existence forcing `OWNER_REVIEW`, but only after the Task is readable on `develop`, cites
the exact source Issue, and has no assignee, implementation branch, or open PR. A pre-existing marker/Task,
identity transfer, or active execution signal remains `OWNER_REVIEW`.

The selected design preserves every historical URL, comment, dependency, Task marker, and PR link. It
does not duplicate full child bodies into parent bodies: the parent records the current mapping and the
Task owns executable detail. Before-state snapshots and immediate write/read-back make each batch
recoverable.

**Independent depth verdict — 2026-08-30:** `DEPTH: LOCAL`. The guardian confirmed that this Task/spec
owns the root policy gap, its enforcement path, RULE-021's contradictory workaround, and the complete
historical consequence; it is not another parent-closure symptom patch.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — governance rule, conversion/triage skills, live audit, tests,
      Task/spec records, and approved GitHub migration state are enumerated above.
- [x] Sibling scan 완료 — backlog rule, Task README, issue-to-backlog, github-issue-triage, live triage
      script/tests, RULE-021 history, three current native hierarchy groups, and conversion marker semantics
      were inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no package, app, public interface, presentation surface, or
      product-family boundary is introduced; the audit extends its existing repository-governance owner.

## Fallback & Degradation Declaration

None

## Solution

### Work unit A — policy and enforcement

1. Remove the mandatory “broad parent → child Issues → close parent with decomposition comment” default
   from the rule and conversion skill. State one Issue → one or more Tasks as the default and enumerate
   the only child-Issue exception grounds once in the rule.
2. Define Issue body, comment, Task/spec, and PR ownership without copying the same current map or plan
   across artifacts. Make body updates sufficient for mechanical absorption; comments remain available
   for new evidence or a decision that benefits from chronology.
3. Extend the existing GitHub triage command with a read-only hierarchy audit. It fetches native parent
   relations with complete pagination and reports every open child exactly once. A retained child requires
   a rendered non-empty reason plus exactly one valid
   `Semantic review: @<github-login> on YYYY-MM-DD — RETAIN` receipt. Reason-only, receipt-only,
   duplicate/variant receipt, comment-only, or code-block-only evidence fails. The audit prints exact
   examined counts and fails `--check` on missing evidence or incomplete visibility. It validates receipt
   structure, while the independent reviewer owns semantic adequacy. The existing `audit` command always
   runs this hierarchy pass, so the normal Audit Intake path cannot omit it.
4. Add focused regression tests for roots, valid retained children, missing/blank exception reasons,
   complete denominator/reset behavior, GraphQL pagination/error propagation, and agreement among the
   rule, both skills, and Task README. The policy regression also requires the permanent semantic-review
   and active-owner `OWNER_REVIEW` protections. Prove the policy test fails against the pre-change text.
   Re-run PROC-017's `conversion-evidence` and `scan-user-execution-plan-order` suites to prove the
   single-cause combined lifecycle remains intact.
5. Remove issue #2490 as RULE-021's source, record that RULE-023 supersedes its opposite policy, terminalize
   the Task as `superseded`, and move its spec to `rejected` with explicit evidence rather than rewriting
   its historical gate entries.

### Work unit B — manifest and migration

1. Re-fetch every open native child and capture the exact population, body, labels, parent, comments,
   Task/PR/assignee/dependency state, and before-state identity in a durable manifest.
2. Cross-review all shards using one rubric. Every `RETAIN` row names observable external-lifecycle
   evidence; Task priority or independent verification alone does not qualify. Every `ABSORB` row names a
   canonical parent and Task; ambiguity, missing Task ownership, active work/owner/assignee/PR, or
   security/data-correctness disposition becomes `OWNER_REVIEW`.
3. Pilot the complete non-security subtree `{issue #2063, issue #2084, issue #2102, issue #2115}`.
   Create/read the issue #2063 AGREEMENT owner and three leaf Tasks first, then apply body/state changes,
   read everything back, and
   run repository/live hierarchy audits. Parent maps are versioned current snapshots: update each affected
   parent exactly once per complete frozen batch snapshot, atomically with every row in that batch; a later
   disjoint batch may replace the snapshot after re-reading the whole parent group.
4. Execute fixed, named, serial continuation batches, each with a fresh manifest read, its own
   recommendation/depth gate, one frozen Issue-ID set, and one repository evidence PR: **B1 pilot**,
   **B2 remaining issue #2079 descendants**, **B3 MCP parents issue #1985 and issue #1986**, and **B4
   throughput issue #2512 plus final
   reconciliation**. A parent group is never split across simultaneously mutable batches. Every batch
   performs snapshot → mutation → immediate read-back → stop on first failed row.
   Issue #2514 is forced to `OWNER_REVIEW` in B4 while PROC-017's Task/spec has active closeout; only after
   PROC-017 terminalizes may the row be re-evaluated for `ALREADY_RESOLVED` or independent retention.
5. Apply only approved rows. Do not delete history, alter unrelated labels, orphan dependency edges, or
   close a child before its group-level parent map and Task mapping are readable.
6. Re-fetch the whole GitHub population and reconcile every manifest row. Record exact before/after
   counts, retained exceptions, unresolved owner-review rows, and recovery actions. Count reduction is
   evidence of deduplication only when every absorbed unit still has a resolvable Task owner.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/skills/issue-to-backlog/SKILL.md`
- `.agents/skills/github-issue-triage/SKILL.md`
- `.agents/tasks/README.md`
- `scripts/harness/github-issue-triage.mjs`
- `scripts/harness/__tests__/github-issue-triage.test.mjs`
- `scripts/harness/__tests__/conversion-evidence.test.mjs` and
  `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` (PROC-017 compatibility verification)
- `.agents/tasks/completed/RULE-021-close-parent-on-decomposition.md` (terminalized/moved)
- `.agents/spec-docs/todo/RULE-021-close-parent-on-decomposition.md` (rejected/moved)
- `.agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md`
- This RULE-023 spec across its lifecycle folders
- A durable work-unit-B manifest whose exact path is fixed before that work unit's approval
- Generated `.agents/loop-runs/*.jsonl` entries required by the governing pipelines
- Live GitHub records named by the approved manifest; no unlisted Issue may be mutated

## Completion Criteria

- [x] TC-01: focused policy regression tests prove the rule, `issue-to-backlog`, `github-issue-triage`,
      and Task README all declare one Issue → Tasks as the default, child Issues as exception-only, the
      body as current-map owner, comments as optional chronological evidence, an independent dated
      semantic `RETAIN` review, and the permanent active-owner `OWNER_REVIEW` closure guard.
- [x] TC-02: focused hierarchy-audit tests prove a root is ignored, a child with a non-empty independent
      lifecycle reason plus exactly one valid semantic `RETAIN` receipt passes; reason-only, receipt-only,
      duplicate/variant receipt, comments/code blocks, missing/blank reasons, and incomplete pagination
      fail closed; exact examined counters reset between runs. Semantic adequacy remains reviewer judgement.
- [x] TC-03: the ordinary live `audit` command always runs the native hierarchy pass, prints the exact
      current open-child denominator and full per-Issue disposition, exits non-zero with `--check` before
      migration, and reports retained versus missing evidence without guessing semantic adequacy. Unrelated
      malformed intake remains separately reported and may still make the aggregate `--check` exit non-zero;
      this work does not mutate unlisted non-child Issues.
- [x] TC-04: RULE-021 no longer claims issue #2490, its Task is archived as `superseded`, its spec is
      archived as `rejected`, and the ordinary triage audit no longer treats issue #2490 as Task-linked.
- [x] TC-05: work unit A passes the targeted Vitest suite, `pnpm harness:scan`, and
      `pnpm harness:verify -- --base-ref origin/develop`, merges into `develop`, and merge read-back proves
      the policy commit is an ancestor of fresh `origin/develop` before any historical Issue mutation;
      PROC-017 conversion-evidence and plan-order suites remain green.
- [x] TC-06: the durable work-unit-B manifest covers 100% of the fresh open-child population exactly once;
      every `RETAIN` row has observable external-lifecycle evidence beyond Task priority/verification,
      independent reviewer identity/date/`RETAIN` verdict, every `ABSORB` row has a canonical parent and
      Task owner, every parent state/map is decided once per
      complete group, and every uncertain/security/data-correctness/active-owner row is held for review.
      The manifest fixes B1 to `{issue #2063, issue #2084, issue #2102, issue #2115}` and B4 holds issue
      number 2514 for PROC-017 closeout.
- [x] TC-07: the pilot's captured before state, applied body/state/Task mapping, immediate GitHub read-back,
      and repository/live audits agree for all four frozen B1 rows; each affected parent map is written
      atomically once for that batch snapshot, and a failed write leaves or restores an open child with no lost history.
- [ ] TC-08: named batches B1–B4 each pass their own recommendation/depth gate and repository evidence PR;
      every approved migration row reaches `NOT_PLANNED`, `COMPLETED`, or retained-open state exactly as its
      disposition declares without orphaning an open PR, assignee, owner, Task marker, native dependency,
      security boundary, or historical Issue URL.
- [ ] TC-09: final reconciliation re-fetches the full population, accounts for every manifest row, records
      exact timestamp/query semantics and before/after counts, leaves zero unreviewed migration rows, and
      reports zero hierarchy failures after every remaining open child carries a readable external-lifecycle
      reason and one valid semantic receipt.
- [ ] TC-10: RULE-023 Task/spec reach their terminal folders with all criteria and generated evidence
      committed; the repository is clean and fresh `develop` contains every policy and migration record.

## Test Plan

| TC-ID | Test Type           | Tool / Approach                                                                              | Notes                                                                                                                                              |
| ----- | ------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | RULE                | focused Vitest policy-owner assertions and pre-change mutation proof                         | Static consistency is deliberate: judgement remains in the rule; the test prevents contradictory defaults.                                         |
| TC-02 | RULE                | focused Vitest fixtures around hierarchy classification and paginated parent loading         | Every fail-closed/error/reset branch is exercised.                                                                                                 |
| TC-03 | Live audit          | `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota --check`           | The normal audit records the current exact examined denominator and per-Issue hierarchy failures while keeping unrelated intake failures distinct. |
| TC-04 | Lifecycle/audit     | Task/spec placement scans plus ordinary live Issue audit                                     | Verify both repository records and GitHub issue #2490 classification.                                                                              |
| TC-05 | CI-equivalent       | targeted Vitest, `pnpm harness:scan`, and `pnpm harness:verify -- --base-ref origin/develop` | Merge-verifier confirms the landing before work unit B.                                                                                            |
| TC-06 | Manifest            | exact row/population comparison plus independent shard cross-review                          | No mutation is permitted from `/tmp` discovery files alone.                                                                                        |
| TC-07 | Live pilot          | captured before/after GitHub API objects, idempotent apply/read-back, and live audit         | Pilot excludes security/data-correctness and active-owner rows.                                                                                    |
| TC-08 | Live migration      | B1–B4 gate/PR evidence plus bounded apply → immediate read-back → manifest reconciliation    | A row failure stops its batch before the next Issue.                                                                                               |
| TC-09 | Live reconciliation | fully paginated GraphQL/REST snapshot and exact manifest join                                | Final zero-hierarchy-failure output, visibility limitations, and held exceptions are explicit.                                                     |
| TC-10 | Lifecycle/CI        | gate records, placement scans, final CI-equivalent verification, merge ancestry check        | Completion is proved from current GitHub and `origin/develop`, not intended manifest state.                                                        |

## User Execution Test Scenarios

Not applicable — this work changes repository governance and GitHub Issue administration, not a
runnable Robota product surface. Live GitHub API read-back and harness verification are the correct
observable evidence.

## Tasks

- [ ] `.agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md` — in-progress

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: complete leading frontmatter block present.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`.
- GATE-WRITE — `type:` is exactly one allowed value: `type: RULE`.
- GATE-WRITE — `tags:` field present in frontmatter: `[github, backlog, governance]`.
- GATE-WRITE — Contains a concrete symptom: the Problem identifies contradictory Issue/Task decomposition instructions, queue growth, duplicated state ownership, 281 open Issues/78 open child Issues, and the false RULE-021 → issue #2490 link.
- GATE-WRITE — Contains a reproduction condition: following the current broad-parent decomposition instructions creates child Issues and closes the parent; the ordinary live triage audit exposes the unrelated issue #2490 conversion link.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: no banned placeholder; the seven-sentence Problem supplies concrete paths, behavior, counts, and consequences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: `## Prior Art Research` present.
- GATE-WRITE — Prior Art Research is substantiated: official GitHub, Linear, and Jira product documentation is cited.
- GATE-WRITE — Research waiver alternative: N/A — research is substantiated, so no `Waived:` declaration is required.
- GATE-WRITE — Research findings feed Alternatives Considered and Decision: reversible hierarchy, mutable descriptions/history, independent lifecycle criteria, and Robota's separate Task/spec execution layer directly motivate the exception-only alternative and preservation controls.
- GATE-WRITE — All Architecture Review Checklist items are `[x]`: 5/5 checked.
- GATE-WRITE — Sibling scan is complete: the checked item names the rule, Task README, both skills, audit implementation/tests, RULE-021 history, live hierarchy groups, and marker semantics inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with pro/con: three alternatives each provide a Pro and Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: alternative 2 removes duplicate queue/priority ownership while retaining independently meaningful external discussion, ownership, security, release, and terminal lifecycles.
- GATE-WRITE — New-surface placement conditional: N/A — no package, app, public interface, presentation surface, layer, or product-family boundary is introduced; the existing repository-governance audit owner is extended.
- GATE-WRITE — Every Completion Criterion has a `TC-N` prefix: 10/10 criteria are `TC-01` through `TC-10`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: TC-01 covers permanent policy, TC-02/03 hierarchy auditing, TC-04 RULE-021 reconciliation, TC-05 policy landing, TC-06 manifest completeness, TC-07 pilot safety, TC-08 migration integrity, TC-09 final reconciliation, and TC-10 lifecycle completion.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: every TC names test output, live audit behavior, repository/GitHub state, manifest reconciliation, merge ancestry, or terminal artifact state that can be observed.
- GATE-WRITE — No criterion uses banned vague phrases: none of `works correctly`, `no errors`, `implemented`, or `displays correctly` appears.
- GATE-WRITE — `## Test Plan` section present.
- GATE-WRITE — One Test Plan row exists for each TC-N: 10 rows match 10 Completion Criteria.
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool/Approach: 10/10 populated; no `TBD`.
- GATE-WRITE — Manual-row Notes requirement: N/A — zero rows use `manual`.
- GATE-WRITE — Tasks section present with placeholder: the RULE-023 Task placeholder is present.
- GATE-WRITE — Evidence Log present and empty before this first run.
- GATE-WRITE — No `## Status` or `## Classification` body sections: lifecycle fields remain frontmatter-owned.

### [RECOMMENDATION REVIEW ROUND 1] — 🔴 REVISE | 2026-08-30

The independent reviewer endorsed the exception-only direction and A→B sequencing but required four
execution-safety corrections: preserve PROC-017's single-cause combined lifecycle and hold active issue
number 2514; make the exact rendered reason plus single semantic receipt contract consistent in Solution/TCs;
distinguish a newly approved migration Task from a pre-existing active Task/identity transfer; and name a
complete B1 set with an atomic versioned parent-map invariant. The revised Decision, Solution, scope, and
TC-02/03/05/06/07 now carry those constraints.

`REVIEW VERDICT: REVISE`

### [RECOMMENDATION REVIEW ROUND 2] — ✅ ENDORSE | 2026-08-30

The independent reviewer confirmed all four prior findings are resolved: PROC-017 remains limited to its
single-cause path and issue #2514 is held for closeout; retained children require one rendered reason plus
one exact semantic receipt; only a newly approved inactive migration Task avoids the active-owner hold;
and B1 is the complete live `{#2063, #2084, #2102, #2115}` subtree with atomic versioned parent snapshots.
The reviewer also re-read remote `origin/develop` at `026d7ac799706d9cd0c2d71b951304bdf8810727`.

`REVIEW VERDICT: ENDORSE`

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "계속 진행해줘"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 3071ef9efdd8 (review 1cc330ac, type/tags 33cd0396)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3071ef9efdd8) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS; the recorded instruction `"계속 진행해줘"` directly authorizes continuation of the currently presented RULE-023 design.
- GATE-APPROVAL — The item is inside the approved boundary: PASS; Route DIRECT applies to this exact document and its reviewed Issue/Task ownership policy, hierarchy audit, RULE-021 reconciliation, and governed child-Issue migration scope.
- GATE-APPROVAL — Independent architecture validation conditional: PASS as N/A; no package, app, public/interface surface, layer, or product-family boundary is introduced, and the existing repository-governance audit owner is extended.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (10)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 830 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
  "specPath": ".agents/spec-docs/todo/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
    ".agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 52 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 1ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 3ms

 Test Files  1 passed (1)
      Tests  43 passed (43)
   Start at  03:35:05
   Duration  122ms (transform 27ms, setup 0ms, collect 29ms, tests 12ms, environment 0ms, prepare 22ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 52 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 1ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 3ms

 Test Files  1 passed (1)
      Tests  43 passed (43)
   Start at  03:35:05
   Duration  122ms (transform 27ms, setup 0ms, collect 29ms, tests 12ms, environment 0ms, prepare 22ms)
```

### [GATE-COMPLETE: TC-03] — ❌ FAIL | 2026-08-30

**Command:** `volta run --node 22.14.0 node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota --check`
**Exit:** 126
**Output:** (last 10 of 367 line(s))

```
  #2525 parent=https://github.com/woojubb/robota/issues/1985 [security] Bound MCP results and spill oversized output securely — missing or blank section
  #2526 parent=https://github.com/woojubb/robota/issues/1985 [security] Add MCP OAuth authorization and credential lifecycle — missing or blank section
  #2527 parent=https://github.com/woojubb/robota/issues/1985 [security] Add an opt-in dynamic authentication header helper — missing or blank section
  #2528 parent=https://github.com/woojubb/robota/issues/1985 [enhancement] Project MCP tool schemas safely across providers — missing or blank section
  #2530 parent=https://github.com/woojubb/robota/issues/1986 [enhancement] Export canonical session runtime tools through MCP — missing or blank section
  #2531 parent=https://github.com/woojubb/robota/issues/1986 [enhancement] Ship robota mcp serve as a carrier-owning stdio product mode — missing or blank section
  #2532 parent=https://github.com/woojubb/robota/issues/1986 [integration] Prove an MCP-served session can also consume MCP tools — missing or blank section
  #2533 parent=https://github.com/woojubb/robota/issues/1986 [security] Add authenticated loopback Streamable HTTP MCP hosting — missing or blank section
  #2534 parent=https://github.com/woojubb/robota/issues/1986 [security] Add remote MCP resource-server authorization and admission — missing or blank section
::examined:: 78 open child issue(s)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-30

**Command:** `volta run --node 22.14.0 pnpm harness:scan`
**Exit:** 0
**Output:** (last 10 of 166 line(s))

```

⚑ 5 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ action-references: RESOLVABILITY NOT VERIFIED on this run (not CI — run with --live to verify resolvability): 12 reference(s) were parsed but none was resolved. An action that does not exist passes this run.
⚑ spec-whitebox-leakage: packages/agent-framework/docs/SPEC.md: 2058/2862 lines (71.9%) outside the standard sections — consider extracting to docs/design/
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 318/757 lines (42.0%) outside the standard sections — consider extracting to docs/design/
⚑ legacy-typescript: legacy-typescript: 2 tracked path(s) are absent from disk (a deletion in this change, or a materialised tree) and were not examined.
⚑ progress-report-quantification: progress-report quantification: 3 finding(s) acknowledged in scripts/harness/progress-report-acknowledgments.json — 3 real violation(s) recorded, not cleared by editing history.

148 scans passed, 1 skipped (99 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/loop-runs/backlog-execution-orchestrator.jsonl,  M .agents/loop-runs/user-request-gate.jsonl,  M .agents/rules/backlog-execution.md,  M .agents/skills/github-issue-triage/SKILL.md,  M .agents/skills/issue-to-backlog/SKILL.md,  M .agents/spec-docs/active/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md,  D .agents/spec-docs/todo/RULE-021-close-parent-on-decomposition.md,  M .agents/tasks/README.md,  D .agents/tasks/RULE-021-close-parent-on-decomposition.md,  M scripts/harness/__tests__/github-issue-triage.test.mjs,  M scripts/harness/github-issue-triage.mjs, ?? .agents/spec-docs/rejected/RULE-021-close-parent-on-decomposition.md, ?? .agents/tasks/completed/RULE-021-close-parent-on-decomposition.md
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-30

**Command:** `volta run --node 22.14.0 node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota`
**Exit:** 0
**Output:** (last 10 of 367 line(s))

```
  #2525 parent=https://github.com/woojubb/robota/issues/1985 [security] Bound MCP results and spill oversized output securely — missing or blank section
  #2526 parent=https://github.com/woojubb/robota/issues/1985 [security] Add MCP OAuth authorization and credential lifecycle — missing or blank section
  #2527 parent=https://github.com/woojubb/robota/issues/1985 [security] Add an opt-in dynamic authentication header helper — missing or blank section
  #2528 parent=https://github.com/woojubb/robota/issues/1985 [enhancement] Project MCP tool schemas safely across providers — missing or blank section
  #2530 parent=https://github.com/woojubb/robota/issues/1986 [enhancement] Export canonical session runtime tools through MCP — missing or blank section
  #2531 parent=https://github.com/woojubb/robota/issues/1986 [enhancement] Ship robota mcp serve as a carrier-owning stdio product mode — missing or blank section
  #2532 parent=https://github.com/woojubb/robota/issues/1986 [integration] Prove an MCP-served session can also consume MCP tools — missing or blank section
  #2533 parent=https://github.com/woojubb/robota/issues/1986 [security] Add authenticated loopback Streamable HTTP MCP hosting — missing or blank section
  #2534 parent=https://github.com/woojubb/robota/issues/1986 [security] Add remote MCP resource-server authorization and admission — missing or blank section
::examined:: 78 open child issue(s)
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 57 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 1ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 3ms

 Test Files  1 passed (1)
      Tests  48 passed (48)
   Start at  03:41:22
   Duration  141ms (transform 30ms, setup 0ms, collect 34ms, tests 14ms, environment 0ms, prepare 26ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 57 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 1ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 3ms

 Test Files  1 passed (1)
      Tests  48 passed (48)
   Start at  03:41:22
   Duration  141ms (transform 30ms, setup 0ms, collect 34ms, tests 14ms, environment 0ms, prepare 26ms)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-30

**Command:** `set -o pipefail; PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:$PATH volta run --node 22.14.0 node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota | rg '^  #2490 .* — one work kind plus intake marker$'`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
#2490 [enhancement] Add gates for package boundaries and shared-file reduction — one work kind plus intake marker
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 64 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 1ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 2ms

 Test Files  1 passed (1)
      Tests  55 passed (55)
   Start at  03:48:28
   Duration  144ms (transform 27ms, setup 0ms, collect 33ms, tests 24ms, environment 0ms, prepare 24ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 64 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 1ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 2ms

 Test Files  1 passed (1)
      Tests  55 passed (55)
   Start at  03:48:28
   Duration  144ms (transform 27ms, setup 0ms, collect 33ms, tests 24ms, environment 0ms, prepare 24ms)
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 65 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 2ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 2ms

 Test Files  1 passed (1)
      Tests  56 passed (56)
   Start at  03:50:32
   Duration  144ms (transform 29ms, setup 0ms, collect 36ms, tests 25ms, environment 0ms, prepare 24ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs --pool=threads --maxWorkers=1 --testTimeout=30000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 65 line(s))

```
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > does not remove priority when Task-marker write-back fails 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > Issue to Task conversion finalization > rejects a Task that cites the same Issue number in a different repository 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > pins the authority handoff and the commands that execute it 0ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > keeps internal decomposition in Tasks and makes child Issues exception-only 2ms
 ✓ scripts/harness/__tests__/github-issue-triage.test.mjs > the rule owns policy and the skill owns procedure > archives RULE-021 as superseded without claiming Issue #2490 2ms

 Test Files  1 passed (1)
      Tests  56 passed (56)
   Start at  03:50:32
   Duration  144ms (transform 29ms, setup 0ms, collect 36ms, tests 25ms, environment 0ms, prepare 24ms)
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 487 line(s))

```
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses each eligibility field 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses duplicate evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses malformed evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses subject mismatch 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses unreachable base 0ms

 Test Files  3 passed (3)
      Tests  196 passed (196)
   Start at  03:51:47
   Duration  114.57s (transform 85ms, setup 0ms, collect 114ms, tests 114.25s, environment 0ms, prepare 67ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 487 line(s))

```
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses each eligibility field 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses duplicate evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses malformed evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses subject mismatch 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses unreachable base 0ms

 Test Files  3 passed (3)
      Tests  196 passed (196)
   Start at  03:51:47
   Duration  114.57s (transform 85ms, setup 0ms, collect 114ms, tests 114.25s, environment 0ms, prepare 67ms)
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 500 line(s))

```
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses each eligibility field 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses duplicate evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses malformed evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses subject mismatch 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses unreachable base 0ms

 Test Files  3 passed (3)
      Tests  209 passed (209)
   Start at  04:24:35
   Duration  143.16s (transform 90ms, setup 0ms, collect 126ms, tests 142.81s, environment 0ms, prepare 74ms)
```

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `PATH="/tmp/robota-node22-corepack-shims:/Users/jungyoun/.volta/tools/image/node/22.14.0/bin:/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:$PATH" pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000 --reporter=verbose`
**Exit:** 0
**Output:**

```
Test Files  3 passed (3)
     Tests  211 passed (211)
  Duration  165.81s
```

The run covers the dependency-free, one-pass audit entity decoder and its semicolonless numeric,
`nbsp`, and `shy` regressions. The root manifest and lockfile are restored to `origin/develop`, so the
policy implementation no longer forces workspace-wide scope merely to decode lifecycle evidence.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `PATH="/tmp/robota-node22-corepack-shims:/Users/jungyoun/.volta/tools/image/node/22.14.0/bin:/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:$PATH" pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000 --reporter=verbose`
**Exit:** 0
**Output:**

```
Test Files  3 passed (3)
     Tests  211 passed (211)
  Duration  165.81s
```

PROC-017 conversion evidence and plan-order compatibility remain green after removing the root
dependency. A separate `pnpm harness:scan` run passed 148 scans with one declared skip.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/gawk/libexec/gnubin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.local/bin:/usr/local/bin:/System/Cryptexes/App/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin:/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin:/pkg/env/global/bin:/Library/Apple/usr/bin:/opt/homebrew/bin:/Users/jungyoun/.volta/bin:/Users/jungyoun/.codex/tmp/arg0/codex-arg0hHXDK4:/Users/jungyoun/.codex/packages/standalone/releases/0.151.0-aarch64-apple-darwin/codex-path:/Users/jungyoun/.bun/bin:/Users/jungyoun/.rd/bin:/Users/jungyoun/.local/bin:/Users/jungyoun/.opencode/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:/opt/homebrew/opt/ruby/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin:/Users/jungyoun/.lmstudio/bin:/Users/jungyoun/Documents/flutter/bin volta run --node 22.14.0 pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs --pool=threads --maxWorkers=1 --testTimeout=120000 --reporter=verbose`
**Exit:** 0
**Output:** (last 10 of 500 line(s))

```
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses each eligibility field 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses duplicate evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses malformed evidence 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses subject mismatch 0ms
 ✓ scripts/harness/__tests__/conversion-evidence.test.mjs > parseConversionEvidence > refuses unreachable base 0ms

 Test Files  3 passed (3)
      Tests  209 passed (209)
   Start at  04:24:35
   Duration  143.16s (transform 90ms, setup 0ms, collect 126ms, tests 142.81s, environment 0ms, prepare 74ms)
```

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT (continuation) — ordering: one prior complete canonical GATE-IMPLEMENT PASS exists;
  the exact Task/spec pair remains `in-progress`, the spec remains under `.agents/spec-docs/active/`,
  and `git log 3faf26ad80046058647b2a61efbe56b4174e0906..a07f051f2b76931ce6c1f10302342f2d7b9f1c5b -- <active RULE-023 spec>` is empty.
- GATE-IMPLEMENT (continuation) — § Decision sequences work units A then B and declares exactly three
  continuation artifacts: base `3faf26ad80046058647b2a61efbe56b4174e0906` contains the single
  machine-readable `Continuation artifacts` line; every declared path exists in both that base tree
  and pre-gate HEAD `a07f051f2b76931ce6c1f10302342f2d7b9f1c5b`, with no byte difference across
  the three paths.
- GATE-IMPLEMENT (continuation) — preceding checkpoint ancestry: PR #2548 integration merge
  `ce6f3589ad4690016a215be4582d991eee0dfe6f` introduced the sole prior RULE-023 GATE-IMPLEMENT PASS
  (one raw PASS versus zero at its first parent), is an ancestor of branch base
  `3faf26ad80046058647b2a61efbe56b4174e0906`, and that exact `origin/develop` base is an ancestor of
  pre-gate HEAD `a07f051f2b76931ce6c1f10302342f2d7b9f1c5b`.
- GATE-IMPLEMENT (continuation) — Task and PLAN preservation: the paired Task is byte-identical between
  base and pre-gate HEAD (`sha256:f6c545c6d327b733494bd0c6148f02739e0488e739499aa926ee91404e2eab92`),
  remains `status: in-progress`, and still records `SCENARIO DRAFTED: not-applicable | 0` with its
  concrete governance-only reason; latest prior raw PASS digest is
  `sha256:9d1a4d45aeb8d12634d4e97a0a5aa7c1f5382e99e3f95bc370ea90544cef5d51`.
- GATE-IMPLEMENT (continuation) — whole-worktree inventory: the pre-gate worktree was clean; the only
  gate write is this active RULE-023 spec. No B2 Task was created and no manifest disposition or other
  B2 implementation path changed. The sole topic commit before this gate,
  `a07f051f2b76931ce6c1f10302342f2d7b9f1c5b`, changes only the permitted append-only closed
  `.agents/loop-runs/post-merge-cycle.jsonl` record for PR #2557.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementContinuation",
  "priorPass": "sha256:9d1a4d45aeb8d12634d4e97a0a5aa7c1f5382e99e3f95bc370ea90544cef5d51",
  "sequencedArtifacts": [
    ".agents/evidence/RULE-023-child-issue-migration-manifest.json",
    ".agents/spec-docs/active/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
    ".agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md"
  ],
  "ancestorSha": "ce6f3589ad4690016a215be4582d991eee0dfe6f",
  "taskPath": ".agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
  "specPath": ".agents/spec-docs/active/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md",
    ".agents/tasks/RULE-023-make-child-issues-exception-only-and-migrate-internal-decomposition-to-tasks.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
