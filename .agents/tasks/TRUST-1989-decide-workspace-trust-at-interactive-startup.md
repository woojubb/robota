---
title: 'TRUST-1989: Decide workspace trust at interactive startup instead of starting restricted and silent'
issue: https://github.com/woojubb/robota/issues/1989
status: todo
created: 2026-09-20
priority: high
urgency: next
area: packages/agent-cli, terminal UI package
depends_on: []
---

# TRUST-1989: Decide workspace trust at interactive startup instead of starting restricted and silent

## Objective

Give the interactive TUI a workspace-trust decision point. Today `workspace-trust-admission.ts` is
consulted only for headless runs — its single production caller in `packages/agent-cli/src/cli.ts`
is guarded by `if ((args.printMode || args.goal !== undefined || args.serve) && ...)` — so `robota`
in an untrusted directory starts anyway in restricted mode, with project settings, hooks, plugins
and skills silently not loaded and no prompt, refusal or banner saying so. The only grant path is
the out-of-band `robota trust --yes`. Decide, at startup, what an interactive session does with an
untrusted, revoked or replaced workspace, and make the answer visible.

## Plan

- [ ] TC-01: Establish the current behaviour as a test: an untrusted interactive start today loads no project contributions and says nothing.
- [ ] TC-02: Decide the interactive policy (prompt, refuse, or start restricted with a visible, dismissible banner) and record the decision with its reasoning.
- [ ] TC-03: Implement the decision on the interactive path without weakening the headless gate.
- [ ] TC-04: Cover revoked, stale/replaced, store-unavailable and identity-unavailable, none of which may resolve to a silent start.

## Test Plan

Unit tests over the startup admission decision for every trust state, a component or PTY test for
whatever the decision renders, and a regression test that the headless gate is unchanged.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (>= 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Start the built CLI in a freshly created, untrusted git repository and observe what the session says
about trust, then grant trust and observe the difference.

## Notes

Found by `proposal-reviewer` on 2026-09-20 while reviewing FLOW-2006, which needs a trust decision
on the directory a deep link names. FLOW-2006 does not patch this: it contains against it by
refusing any link target whose trust state is not already `trusted` (`Contained — TRUST-1989`), so
the containment is safe and this record owns the real fix. Registered on the workspace-trust umbrella
[issue #1989](https://github.com/woojubb/robota/issues/1989).
