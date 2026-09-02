---
name: issue-to-backlog
description: Convert a filed GitHub issue into the backlog Task document(s) it actually is — deciding how many items its contents are, not assuming one. Use when a session picks up an issue to work on, before any code changes. The counterpart to find-to-issue, which files at a different time for a different reason.
---

# Issue → Task

A GitHub issue is an externally tracked capture of intent or a problem. A Task is an executable unit of
work. **They are not the same shape, and one issue is not automatically one Task.**

## Rule Anchor

- [`.agents/tasks/README.md`](../../tasks/README.md) — required frontmatter, Test Plan, scenarios,
  and the done gate.
- [`backlog-execution.md`](../../rules/backlog-execution.md) — the policy SSOT for the Issue ↔ Task
  boundary and one-Task/one-PR execution shape.
- [finding-depth.md](../../rules/finding-depth.md) — owns "is this one item or several".
- [user-request-gate](../user-request-gate/SKILL.md) — the conversion IS the gate step for the issue.

## The judgement that makes this a skill

**Group the issue's contents by CAUSE, not by the count of things it lists.** An issue naming eight
deliverables may be four causes, or one. Splitting by artifact count produces items that cannot be
verified independently; splitting by cause produces items that can.

The cost of getting this wrong is measured, not hypothetical: an item in this repository grew from 3
packages to 13 across twelve review rounds because each verified finding was absorbed into it rather
than routed to its owner. Every expansion was individually justified. The aggregate was still the
wrong unit of work, and nothing in the loop was responsible for noticing.

**Read the issue for the groupings it already makes.** An author who wrote "both of these are the same
root error" or "two skills, because they run at different times" has done part of this work for you.

## Boundary decision

Use this order:

1. Keep the GitHub Issue as the canonical external problem while deciding how its causes divide. Do not
   implement directly from a broad Issue; update its body with the current Issue/Task map instead.
   The Issue body owns the current external problem and map; exact Task-marker comments remain mandatory
   append-only conversion receipts even when no narrative comment is needed.
2. Create Tasks for internal cause decomposition. Each Task has one recommendation gate, one verification
   plan, and one independent completion decision, and may cross package boundaries. Several related Tasks
   may use one parent `AGREEMENT` Task and paired spec without creating another Issue.
3. Create or retain a child Issue only when the rule's independent-external-lifecycle test passes. Put
   the observable reason in a non-empty `## Independent external lifecycle` body section and read the
   native parent link and body back. Before creation or retention, obtain a semantic `RETAIN` review from
   someone other than the author/conversion actor and record reviewer identity, date, and verdict in that
   section as `Semantic review: @<github-login> on YYYY-MM-DD — RETAIN`. Package, file, test, phase, Task
   priority, agent assignment, or Task verification differences
   alone do not pass that test; a non-empty section or passing structural audit is not semantic approval.
4. Keep package adapters, protocol frames, tests, and CLI wiring in the same Task when they are only
   implementation steps for that cause. Do not create one Task per package or deliverable.
5. Split a Task only when the design reveals distinct causes or independently verifiable outcomes. If
   several related Tasks share a cross-package boundary, add a parent `AGREEMENT` Task and paired
   spec-doc; do not add another GitHub issue solely for internal sequencing.

Security/authentication and feature behavior are separate Tasks when their trust assumptions, failure
policy, or verification differ, even if they use the same transport. This is a cause split, not a package
split.

## Procedure

1. **Read the issue in full**, including its constraints — those become the Task's, not prose to
   summarize away.
2. **Survey what already exists** before writing. A skill, rule or scan the issue asks for may be
   present under another name, or its subject may already be filed. Record what you find in the Task;
   the next session should not re-derive it.
3. **Classify the issue.** Decide whether it is one external problem with one or several internal causes,
   or contains a cause with a genuinely independent external lifecycle. Say how many Tasks the contents
   become and why. Dispatch
   `finding-depth-triager` if the grouping is not obvious.
4. **Write the Task(s)** per the README schema. Cite the source Issue in every Task. For several
   related children, add a parent `AGREEMENT` Task
   **and its paired spec-doc** — `task-archival` fails an AGREEMENT with no spec.
   If the judgement created an exception-only child Issue, link it to the parent and read both the link
   and its `## Independent external lifecycle` section back. Update the canonical parent body map.
   Decide parent state from the complete external problem group; Task decomposition never closes it by
   itself. Add a narrative comment only for a discovery or dated decision that benefits from chronology.
   Before absorbing or closing an existing child, inspect assignee, every cited open Task, linked open PR,
   and live linked branch/worktree. Any one forces `OWNER_REVIEW`; perform no mutation until the responsible
   owner records dated approval of the exact parent, Task mapping, and terminal disposition. The sole
   prerequisite exception is a new canonical migration Task created from an approved frozen manifest:
   its mere existence does not force `OWNER_REVIEW` only after it is readable on `develop`, cites the exact
   source Issue, and has no assignee, implementation branch/worktree, linked open PR, pre-existing Task
   marker, identity transfer, or active execution. Any pre-existing Task or marker and every active signal
   still force `OWNER_REVIEW`.
5. For an `AGREEMENT` conversion, stage one complete atomic manifest before finalizing the Issue:
   - one newly added exact-basename parent Task/pre-checkpoint `type: AGREEMENT` spec pair;
   - every uniquely declared child as a newly added, non-AGREEMENT `todo` Task citing the Issue whose
     outcome that Task owns. For one-Issue internal decomposition the records may repeat the same source;
     when absorbing an existing Issue hierarchy, the AGREEMENT cites the tracker and each child Task cites
     its exact leaf Issue;
   - exact `## Children` and `## Tasks` rows for those child IDs, statuses, and paths; and
   - no unrelated, pre-existing, nested-AGREEMENT, non-todo, or implementation path.
     Run `node scripts/harness/scan-user-execution-plan-order.mjs --staged`, then commit this conversion
     prelude as one planning unit. The children remain separate execution units after conversion.
6. For a triaged P0/P1 Issue, use
   [`github-issue-triage`](../github-issue-triage/SKILL.md) to dry-run and finalize the handoff. P0 maps
   to Task `urgency: now`; P1 maps to `urgency: soon`; P2 must be promoted first. Finalization writes
   the exact Task ID/path back to the Issue and reads it before removing the P label. Do not implement
   while either operation is incomplete. A Task created without an Issue does not run this step.
7. Record any finding the conversion itself produced; do not turn internal implementation steps into
   new issues unless they meet the child-issue test above.
8. **Verify**: `task-lifecycle.mjs classify` returns `open` for each, and `pnpm harness:scan` is green.

## Do not

- **Do not close an Issue merely because it was decomposed.** It closes when the tracked external problem
  lands or receives a truthful terminal disposition. Internal decomposition stays in Tasks; a retained
  child must pass the rule's external-lifecycle test.
- **Do not start the work in the same change.** The conversion is the gate; walking through it is the
  next step, not this one.
- **Do not carry the issue's structure into the Task** if that structure is a list of deliverables
  rather than a statement of causes.

## Combined lifecycle handoff (PROC-017)

For one eligible, single-cause enhancement Issue, continue the existing Task/spec pair on the same
ordered topic branch after the GitHub Task marker has been written and read back. Record exactly one
`Conversion evidence:` line and one `Combined lifecycle eligibility:` line in the Task before the
planning checkpoint. Marker/read-back and priority-label mutation remain owned by
`github-issue-triage.mjs`; this skill never treats a local write as remote success. Refused, malformed,
security, data-correctness, user-decision, multi-owner, or contract-owned Issues remain on the guarded
route.
