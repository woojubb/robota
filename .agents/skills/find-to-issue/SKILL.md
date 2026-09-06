---
name: find-to-issue
description: Record a defect or follow-up discovered MID-TASK in .agents/learn.md and keep going. Use the moment you notice something real that is not what you are currently doing — authoring a backlog file inline disturbs the work in flight, filing a GitHub issue for it costs a network round-trip and grows the issue count, and dropping the finding loses it. Recording it is not authorization to change code; a GitHub issue and the conversion to a backlog item happen later, only when a person asks for it.
---

# Find → Learn

A defect is most often discovered **in the middle of other work**. The filing machinery assumes the
opposite: Task documents are written deliberately, with frontmatter, a Test Plan and scenarios, and a
GitHub Issue is a durable external record with its own upkeep. Applied mid-task, either means stopping
— and the practical alternative is dropping the finding.

This skill is the third option: capture it cheaply, in [`.agents/learn.md`](../../learn.md), keep going.

## Rule Anchor

- [finding-depth.md](../../rules/finding-depth.md) — owns whether a finding belongs to the current
  item or is its own root item. **Route the question there; do not answer it here.**
- [learning-loop.md](../../rules/learning-loop.md) — how `.agents/learn.md` entries are later worked
  as a batch, only on the user's explicit request.
- [`.agents/tasks/README.md`](../../tasks/README.md) — what a later conversion to a Task must produce.

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
- **Record it** if it is real, reproducible from what you observed, and fixing it would widen the work
  in flight.
- **Neither** if you cannot say what you observed and where. A vague record costs the next session more
  than it saves you.

## What to do: append one record, nothing else

No network call, no `gh` invocation, no Task, no rule change. Append one entry to
[`.agents/learn.md`](../../learn.md) in the format that file declares:

```md
### LRN-<stable-id>

- observed-at: <ISO timestamp>
- observation: <one sentence>
- evidence: <file:line, command output, or URL — at least one>
- source: <current Task ID or session>
- related: <known Issue/Task/PR ID, omit if none>
```

If a normal Task branch is already in flight, include the `.agents/learn.md` change with it. If none
is, record it locally and tell the user it is not yet shared — do not open a Task, branch, PR, or
protected-branch exception just to publish one finding; it goes out with the next normal change, or
when the user asks to sync.

Seeing the same thing again is not a new record — add a dated evidence line under the existing entry.
If you cannot find the existing ID with a quick search, record a new one anyway; reconciling
near-duplicates happens in batch, at lesson time, not here.

## A GitHub issue is still allowed — just not automatic

Nothing here removes anyone's ability to open a GitHub Issue directly (`gh issue create` or the web
UI) for a finding that is ready to be tracked externally right now. What this skill removes is the
default reflex of filing one for every mid-task observation. When a person does open one afterward,
[`github-issue-triage`](../github-issue-triage/SKILL.md) and
[`issue-to-backlog`](../issue-to-backlog/SKILL.md) still own everything from that point on.

## Recording is not authorization

[user-request-gate](../user-request-gate/SKILL.md) gates code changes behind a backlog draft. A
`.agents/learn.md` entry is **not** that draft, and recording one does not permit you to start changing
code for it. It captures the finding so the gate can be walked properly later.

## Then keep going

Return to the work in flight. Do not start the finding's work, do not restructure the current change
around it, and do not report the finding as handled — it is recorded, which is a different thing.
