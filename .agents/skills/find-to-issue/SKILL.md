---
name: find-to-issue
description: File a defect or follow-up discovered MID-TASK as a GitHub issue and keep going. Use the moment you notice something real that is not what you are currently doing — authoring a backlog file inline disturbs the work in flight, and dropping the finding loses it. Filing an issue is not authorization to change code; the conversion to a backlog item happens later, in issue-to-backlog.
---

# Find → Issue

A defect is most often discovered **in the middle of other work**. The filing machinery assumes the
opposite: Task documents are written deliberately, with frontmatter, a Test Plan and scenarios. Applied
mid-task that means stopping — and the practical alternative is dropping the finding.

This skill is the third option: capture it cheaply, keep going.

## Rule Anchor

- [finding-depth.md](../../rules/finding-depth.md) — owns whether a finding belongs to the current
  item or is its own root item. **Route the question there; do not answer it here.**
- [`.agents/tasks/README.md`](../../tasks/README.md) — what the later conversion must produce.

## Use This Skill When

You notice, while doing something else, that:

- something is broken that is not what you are fixing;
- a rule has no mechanism, or a mechanism cannot fail;
- a contract is stated in two places, or in none;
- a follow-up is implied by the change you are making but is not part of it.

## Do not use it as a drop-box

The bar, and it is the whole discipline of this skill:

- **Fix it now** if it is inside what you are already changing and fixing it does not widen the change.
  A finding inside your own diff is not a "later".
- **File an issue** if it is real, reproducible from what you observed, and fixing it would widen the
  work in flight.
- **Neither** if you cannot say what you observed and where. A vague issue costs the next session more
  than it saves you.

## What the issue must carry

Enough that the next session does not re-derive the finding:

1. **What was observed** — the concrete symptom, with file:line or a command and its output.
2. **Where** — the package, rule or document.
3. **Why it was not fixed inline** — one sentence. This is what stops the skill becoming a drop-box,
   because a reason that reads as "did not feel like it" is visible as one.
4. **What it is NOT** — if you suspect a depth question (is this the current item's, or its own root?),
   say so and leave it for the triager rather than deciding.

## Filing is not authorization

[user-request-gate](../user-request-gate/SKILL.md) gates code changes behind a backlog draft. An issue
is **not** that draft, and filing one does not permit you to start changing code for it. It records
the finding so the gate can be walked properly later.

Use an Issue Form when one matches. A manual/API-created Issue must receive `status:needs-triage`
explicitly so it cannot disappear between intake paths. The
[`github-issue-triage`](../github-issue-triage/SKILL.md) skill owns later classification and selection;
do not assign a P label merely to make the newly filed Issue look complete.

## Then keep going

Return to the work in flight. Do not start the issue's work, do not restructure the current change
around it, and do not report the finding as handled — it is recorded, which is a different thing.
