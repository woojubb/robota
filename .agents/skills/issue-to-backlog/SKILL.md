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

1. Keep the GitHub issue as the parent initiative while deciding how its causes divide. Do not implement
   directly from a broad parent issue. Once the causes have been split into child Issues, the parent is
   no longer an open work item: link every child, record the decomposition, and close the parent with
   a comment naming the child Issues. This prevents an open parent from being selected and decomposed
   repeatedly.
2. Create a child issue when a cause needs separate external discussion, priority, ownership, security
   review, or terminal disposition.
3. Create a Task when the cause can have one recommendation gate, one verification plan, and one
   independent completion decision. A Task may cross package boundaries.
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
3. **Classify the issue.** Decide whether it is a parent initiative, one child cause, or several causes.
   Say how many Tasks the contents become and why. Dispatch
   `finding-depth-triager` if the grouping is not obvious.
4. **Write the Task(s)** per the README schema. Cite the source issue in every Task. For several
   related children, add a parent `AGREEMENT` Task
   **and its paired spec-doc** — `task-archival` fails an AGREEMENT with no spec.
   If the judgement created child GitHub Issues, link every child to the parent and read those links
   back before proceeding. Then close the parent with a decomposition comment listing each child; the
   parent must not remain open as a second work item.
5. For an `AGREEMENT` conversion, stage one complete atomic manifest before finalizing the Issue:
   - one newly added exact-basename parent Task/pre-checkpoint `type: AGREEMENT` spec pair;
   - every uniquely declared child as a newly added, non-AGREEMENT `todo` Task citing the same Issue;
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

- **Do not close an unsplit issue on conversion.** It closes when the tracked work lands. A parent that
  has been decomposed into child Issues is the exception: after all child links are readable, close the
  parent immediately with the decomposition comment; the children carry the remaining work.
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
