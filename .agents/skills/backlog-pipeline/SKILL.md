---
name: backlog-pipeline
description: Orchestrator for the spec document gate pipeline. Reads current status from frontmatter, determines the next gate, invokes backlog-writer or backlog-gate-guard, and updates frontmatter status on PASS. Does nothing else.
invocable: true
---

# Backlog Pipeline

State machine orchestrator for spec documents. This skill manages ONLY the pipeline flow — it does not write content, judge quality, or perform implementation.

## Rule Anchor

- `AGENTS.md` > Mandatory Rules > Process
- `.agents/rules/spec-workflow.md` > HARD GATE: No Immediate Implementation
- `.agents/rules/spec-workflow.md` > Lanes — which gates a document runs, by its `lane:`

## When to Use

Invoke this skill at the start of ANY spec document lifecycle:

- Creating a new spec document
- Resuming work on an existing spec document
- Checking what gate comes next

## STOP Conditions (non-negotiable)

Before any gate transition, verify:

1. The spec document has been located (see File Location Protocol below)
2. The `status:` frontmatter field matches a known state in the table below
3. The previous gate's Evidence Log entry exists (PASS, FAIL, or NON-COMPLIANCE)

If any condition is unmet: **STOP. Do not proceed. Write a NON-COMPLIANCE entry and surface the issue to the user.**

## File Location Protocol

Spec documents live under `.agents/spec-docs/<stage>/`. When given only an ID (not a full path):

```
Run: find .agents/spec-docs -name "<ID>*.md" -not -path "*/rejected/*"
Exactly 1 result → use that path
0 results        → STOP: file not found, surface to user
>1 results       → STOP: ambiguous ID, surface all found paths to user
```

When given a full path, use it directly.

## State Machine

Dispatch by current status. **The folder each status lives in is not this skill's fact** — the rule
owns the status ↔ folder mapping ([`spec-workflow.md`](../../rules/spec-workflow.md) >
Spec-Document Status and Lifecycle Folders), and every move below is derived from it: on PASS the
document goes to the folder the rule maps the **next** status to. When both statuses map to the same
folder, there is no move.

The lane column is the document's `lane:` frontmatter field, as `spec-workflow.md` > Lanes defines it.
An L0 change has no spec document and never enters this skill.

| Current `status`  | Lane | Next Action                                                                                      | Next `status` on PASS |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------ | --------------------- |
| (not yet created) | L1   | `node scripts/harness/new-spec.mjs <ID> --type <T> --issue <N> --lane L1`                        | `draft`               |
| (not yet created) | L2   | Invoke `backlog-writer` skill                                                                    | `draft`               |
| `draft`           | L1   | `gate.mjs approve --route CLASS --class LANE-L0-L1`, then `gate.mjs judge --gate PLAN --lane L1` | `approved`            |
| `draft`           | L2   | `gate.mjs judge --gate GATE-WRITE`, then guard on the semantic set                               | `review-ready`        |
| `review-ready`    | L2   | `gate.mjs approve`, then `gate.mjs judge --gate GATE-APPROVAL`, guard on the semantic set        | `approved`            |
| `approved`        | L1   | `gate.mjs judge --gate DONE` (GATE-VERIFY + GATE-COMPLETE criteria)                              | `done`                |
| `approved`        | L2   | `gate.mjs judge --gate GATE-IMPLEMENT`, then guard on the semantic set                           | `in-progress`         |
| `in-progress`     | L2   | `gate.mjs judge --gate GATE-VERIFY`, then guard on the semantic set                              | `verifying`           |
| `verifying`       | L2   | `gate.mjs judge --gate GATE-COMPLETE`, then guard on the semantic set                            | `done`                |
| `done`            | any  | No action. Pipeline is complete.                                                                 | —                     |
| `rejected`        | any  | No action. Item is closed.                                                                       | —                     |

**Out-of-band gate:** `GATE-CONFORMANCE` (architecture conformance) is NOT a status transition and does
not appear in this table. It is run separately via `backlog-gate-guard` — on demand, after cross-package
work, and before a `develop → main` release. See
[gate catalogue > GATE-CONFORMANCE](../../specs/gate-catalogue.md) and
[`spec-workflow.md` > GATE-CONFORMANCE](../../rules/spec-workflow.md).

## Execution Steps

### Step 1 — Read current state

```
1. Locate the spec document (see File Location Protocol above)
2. Read the frontmatter `status:` field
3. Match to the state table above
4. Verify the last Evidence Log entry exists for the previous gate
```

### Step 2 — Invoke the appropriate component

**When status is (not yet created):**

- Invoke `backlog-writer` skill (Skill tool)
- After writer completes, create the file at `.agents/spec-docs/draft/<ID>.md`

**When status is `draft` through `verifying`:**

1. Run `node scripts/harness/gate.mjs judge --gate <GATE> --doc <PATH>`; on exit 0 with no semantic
   criteria pending, the gate is passed and the entry is written; dispatch `backlog-gate-guard` only when
   it exits non-zero or reports semantic criteria (L2). The script judges the criteria the catalogue tags
   mechanical and writes the Evidence Log entry itself.
2. For GATE-APPROVAL (and the L1 PLAN gate, which contains it), the approval is recorded by
   `node scripts/harness/gate.mjs approve --doc <PATH> --route DIRECT|CLASS --instruction "<verbatim>" [--class <ID>]`
   — the instruction is quoted verbatim, and Route CLASS names a class from the registry in
   `backlog-execution.md` > Delegated Approval Classes. `approve` runs BEFORE the gate that contains
   GATE-APPROVAL: until it has, `judge` reports those criteria `PENDING — run approve first` (exit 2)
   and writes no entry. For `LANE-L0-L1` the evidence is measured by the script (it runs
   `scan-lane-declaration` over the branch's changed set), not typed.

**The L1 lane, in order** — each step is one of the commands above; none is skipped or reordered:

1. `node scripts/harness/new-spec.mjs <ID> --type <T> --issue <N> --lane L1` — scaffold
2. Write Problem, Decision and the TC-N criteria
3. `gate.mjs approve --doc <PATH> --route CLASS --class LANE-L0-L1 --instruction "<verbatim>"` —
   evidence measured by the script
4. `gate.mjs judge --gate PLAN --doc <PATH> --lane L1`
5. `gate.mjs advance --doc <PATH>` (`draft → approved`, `todo/`)
6. ONE planning commit — the spec and its Task, trailer `Lane: L1`
7. Implement, then tick what is done BEFORE judging it: every `TC-NN` checkbox in the spec, every
   Task Plan item, and a test reference (a `.test.` / `__tests__/` path, or a skip reason) in each
   Test Plan row — DONE's criteria read those boxes, and a FAIL entry is permanent
8. `gate.mjs record --doc <PATH> --tc TC-NN …` per TC
9. `gate.mjs judge --gate DONE --doc <PATH> --lane L1 --verify-cmd "<build-shaped>" --verify-cmd "<test-shaped>"`
   (an affected scan run counts as build-shaped: `node scripts/harness/run-all-scans.mjs --affected --context pr …`)
10. `gate.mjs advance --doc <PATH>` (`approved → done`, `done/`), the Task to `completed/`, commit

When the guard is dispatched — the [`backlog-gate-guard` agent](../../../.claude/agents/backlog-gate-guard.md)
(Agent tool), one gate per invocation — it owns how to judge; give it only the two inputs it needs:

```
Gate: <GATE>            (e.g. GATE-WRITE)
Document: <PATH>        (e.g. .agents/spec-docs/draft/CLI-050-some-feature.md)
Criteria catalogue: .agents/specs/gate-catalogue.md
```

Do not restate the criteria in the prompt — the catalogue is their single owner, and a prompt-side copy
drifts from it silently.

Wait for its terminal line: `GATE VERDICT: PASS | FAIL | NON-COMPLIANCE`

### Step 3 — Handle gate result

Look up the folder the rule maps the **next** status to.

**PASS:**

1. Run `node scripts/harness/gate.mjs advance --doc <PATH>`. It moves the file to the folder the rule
   maps the next status to (no move when both statuses map to the same folder) and rewrites the
   frontmatter `status:` in the same step — the rule's folder ↔ status agreement is what makes a
   half-done move a NON-COMPLIANCE on the next run, which is why the two are never done by hand.
2. Confirm to user: "Gate X passed. Status: `<next-status>`. File now in `<that-folder>`."

**FAIL:**

- Do NOT update frontmatter status or move the file
- Surface the failed criteria to the user
- STOP. Do not attempt to fix or implement. Wait for user direction.

**NON-COMPLIANCE:**

- Do NOT update frontmatter status or move the file
- Write the NON-COMPLIANCE entry to Evidence Log (if guard didn't already)
- STOP immediately. Surface: which gate was violated, what evidence is missing.
- Do not proceed until violation is resolved.

## Rejection Action

A file moves to `rejected/` when:

1. User explicitly cancels the item ("취소", "거부", "reject this item"), OR
2. A NON-COMPLIANCE violation is determined to be unresolvable

Rejection steps:

1. `git mv <current-path> .agents/spec-docs/rejected/<filename>`
2. Update frontmatter `status: rejected` in the moved file
3. Append Evidence Log entry: `[REJECTION]` with reason and date
4. Stop pipeline for this item

Note: GATE FAIL is NOT a rejection. FAIL means the item can be fixed and re-run. Rejection is a deliberate decision to close the item permanently.

## What This Skill Does NOT Do

- Write or edit spec document section content → that is `backlog-writer`
- Judge whether content meets quality criteria → `gate.mjs judge` for the mechanical criteria,
  `backlog-gate-guard` for the semantic ones
- Implement the spec document → that is the agent's separate implementation work
- Modify Evidence Log entries → `gate.mjs` and `backlog-gate-guard` write them
- Choose or argue a lane → the lane is the document's `lane:` field, declared by the change and refused
  by `scan-lane-declaration` when under-declared; this skill reads it and runs that lane's gates
- Skip a lane's gates for any reason, including "obvious" items or small changes

## Anti-Patterns

| Anti-pattern                                            | Correct behavior                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Moving to next gate without Evidence Log entry          | STOP. Write NON-COMPLIANCE.                                                      |
| Skipping GATE-APPROVAL because "it's implied"           | STOP. User must explicitly approve. Quote required.                              |
| Running gate guard inline instead of as subagent        | Always spawn as Agent subagent for isolation.                                    |
| Fixing FAIL items and immediately re-running the gate   | Surface the failure to the user first. Re-run only after user confirms fix.      |
| Setting status to `done` before GATE-COMPLETE           | Status changes only follow gate PASS results.                                    |
| Moving the file or editing `status:` by hand            | `gate.mjs advance` does both in one step; a half-done move is NON-COMPLIANCE.    |
| Dispatching the guard before `gate.mjs judge` has run   | The script judges the mechanical set first; the guard sees only the residue.     |
| Running an L2 gate set on an L1 document, or vice versa | Read `lane:`; the state-machine table is keyed on it.                            |
| `judge --gate PLAN` before `approve` on an L1 document  | `approve` first; PLAN reports the approval criteria PENDING (exit 2) until then. |
