---
title: 'HARNESS-103: scan-interface-runtime checks a narrower thing than the rule it enforces'
status: todo
created: 2026-08-16
priority: medium
urgency: later
area: scripts/harness, packages/agent-interface-transport
depends_on: []
issue: https://github.com/woojubb/robota/issues/1797
---

# HARNESS-103: scan-interface-runtime checks a narrower thing than the rule it enforces

## Problem

Found by `proposal-reviewer` while judging ARCH-029's recommendation. Filed rather than folded in:
it is a gap between a rule's words and its mechanism, owned by the harness axis, and ARCH-029's
design avoids the file entirely so it is not a blocker there.

`.agents/project-structure.md:308` states that an `agent-interface-*` package **"must not contain
classes or runtime logic"**.

`scripts/harness/scan-interface-runtime.mjs` (INFRA-035) enforces a narrower thing: no `class`/`enum`
declarations and no bare value imports. A **factory function** containing runtime behaviour passes
the scan while sitting outside the stated rule.

The live instance: `packages/agent-interface-transport/src/session-capability-host.ts` — 120 lines of
prototype-walking descriptor forwarding, accessor caching, reserved/duplicate-member rejection and
freezing. It passes the scan.

## Direction

Two things to decide together:

1. **Does the rule mean what it says?** If interface packages may host generic runtime mechanisms,
   that is a `project-structure.md` amendment, not an exemption.
2. **If it does mean what it says, the scan should measure it.** A rule whose mechanism checks
   something narrower produces a green that does not mean what a reader thinks it means.

The file has **zero production consumers** — its only callers are its own unit test and a
published-SDK scenario — so nothing in-repo depends on the answer today.

## Blockers

- None.

## Result

Pending.
