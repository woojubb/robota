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

| Current `status`  | Next Action                                          | Next `status` on PASS |
| ----------------- | ---------------------------------------------------- | --------------------- |
| (not yet created) | Invoke `backlog-writer` skill                        | `draft`               |
| `draft`           | Invoke `backlog-gate-guard` subagent: GATE-WRITE     | `review-ready`        |
| `review-ready`    | Invoke `backlog-gate-guard` subagent: GATE-APPROVAL  | `approved`            |
| `approved`        | Invoke `backlog-gate-guard` subagent: GATE-IMPLEMENT | `in-progress`         |
| `in-progress`     | Invoke `backlog-gate-guard` subagent: GATE-VERIFY    | `verifying`           |
| `verifying`       | Invoke `backlog-gate-guard` subagent: GATE-COMPLETE  | `done`                |
| `done`            | No action. Pipeline is complete.                     | —                     |
| `rejected`        | No action. Item is closed.                           | —                     |

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

Dispatch the [`backlog-gate-guard` agent](../../../.claude/agents/backlog-gate-guard.md) (Agent tool),
one gate per invocation. The agent owns how to judge; give it only the two inputs it needs:

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

**PASS (the next status maps to a different folder):**

1. Run `git mv <current-path> <that-folder>/<filename>`
2. Immediately update the frontmatter `status:` field in the moved file to the next status value
3. Both steps must complete before reporting success — the rule's folder ↔ status agreement is what makes a half-done move a NON-COMPLIANCE on the next run.
4. Confirm to user: "Gate X passed. Status: `<next-status>`. File moved to `<that-folder>`."

**PASS (the next status maps to the same folder — no move):**

1. Update the frontmatter `status:` field in place
2. Confirm to user: "Gate X passed. Status: `<next-status>`. File stays in `<that-folder>`."

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
- Judge whether content meets quality criteria → that is `backlog-gate-guard`
- Implement the spec document → that is the agent's separate implementation work
- Modify Evidence Log entries → that is `backlog-gate-guard`
- Skip gates for any reason, including "obvious" items or small changes

## Anti-Patterns

| Anti-pattern                                          | Correct behavior                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Moving to next gate without Evidence Log entry        | STOP. Write NON-COMPLIANCE.                                                 |
| Skipping GATE-APPROVAL because "it's implied"         | STOP. User must explicitly approve. Quote required.                         |
| Running gate guard inline instead of as subagent      | Always spawn as Agent subagent for isolation.                               |
| Fixing FAIL items and immediately re-running the gate | Surface the failure to the user first. Re-run only after user confirms fix. |
| Setting status to `done` before GATE-COMPLETE         | Status changes only follow gate PASS results.                               |
| Forgetting to update frontmatter after `git mv`       | Both `git mv` and frontmatter update are atomic. Do both immediately.       |
| Assuming every PASS moves the file                    | Derive it: no move when both statuses map to the same folder in the rule.   |
