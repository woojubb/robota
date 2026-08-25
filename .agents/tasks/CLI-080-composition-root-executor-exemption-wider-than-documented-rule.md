---
title: 'CLI-080: the composition-root agent-executor exemption is granted to a concrete git-worktree adapter, wider than the documented "single permitted exception" — align the rule text or relocate the contract'
status: todo
created: 2026-08-13
priority: low
urgency: later
area: packages/agent-cli, .agents/project-structure.md, scripts/harness/check-background-workspace-conformance.mjs
depends_on: []
---

# CLI-080: executor-import exemption exceeds its documented scope

## Problem

The project-structure rule says `agent-cli`'s only permitted direct import of `@robota-sdk/agent-executor`
is the composition root (app assembly point). The mechanical guard grants a third exemption to a
concrete git-worktree adapter that value-imports `BackgroundTaskError` — which is an implementation
class doing git/fs I/O, not the assembly point. The guard's exemption set and the rule text disagree
about what "composition root" covers.

## Evidence

- `.agents/project-structure.md:375-385` (cited as `:357-370` when filed; the text moved, not the rule) — "the **single permitted exception** is the **composition
  root** … composition-root wiring is the only valid exemption category."
- `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts:6-11` — value-imports
  `BackgroundTaskError` (plus port types) from `@robota-sdk/agent-executor`.
- `scripts/harness/check-background-workspace-conformance.mjs:73-79` — a third exemption entry:
  "`…/git-worktree-isolation-adapter.ts`: 'composition root — concrete worktree adapter wiring'". The
  adapter is a concrete I/O class, not the assembly point.

## The direction, and what the guard actually enforces

**Issue #2048 states this backwards, and acting on its summary would enlarge the hole.** Its line 8
says the guard exempts the adapter _"under a category **narrower** than the written rule permits"_;
its own line 17 says _"a guard exemption **wider** than the documented category"_, which is what this
record's title has said since it was filed. The evidence line is right and the summary line is what a
reader acts on — someone implementing line 8 as written would widen an already-over-wide exemption
while believing they were aligning it. Issue #2048 is closed with that noted.

**The mechanism is the reason this recurs.** The guard's own comment states the requirement it
enforces: _"every entry requires a reason string"_ (`check-background-workspace-conformance.mjs:73`).
That is exactly what is checked — **a reason, not a true one.** The first two exemptions are the
rule's own worked examples; the third asserts membership in the category by writing the category's
name into a free-text string. The rule says composition-root wiring is the only valid category, and
**nothing checks that a file claiming the category is one.**

So the doc-side and code-side directions above are both still open, but neither closes this on its
own: whichever is chosen, a category that a file can join by describing itself will drift again. That
belongs in whatever fix lands here, not in a separate item.

## Direction

Doc-side (likely): extend the project-structure exemption text to name the third sanctioned shape (a
CLI host adapter implementing an executor-owned port), so the rule and the guard agree. Code-side
alternative: move `ISubagentWorktreeAdapter`/`BackgroundTaskError` to a contract layer the CLI may
reach without the executor import, retiring the exemption.

## Test Plan

- If doc-side: the rule text names the adapter category; the guard's three exemptions all match a
  documented category.
- If code-side: `rg` shows no `@robota-sdk/agent-executor` value import outside the assembly point; the
  guard's exemption list drops to two.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — rule/guard alignment (or a type relocation) with no user-facing behavior change.
