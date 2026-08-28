---
title: 'HARNESS-120: wide-blast approval needs independent adversarial review'
issue: https://github.com/woojubb/robota/issues/2326
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2326#issuecomment-5456692501
created: 2026-08-25
priority: high
urgency: soon
area: .agents/rules, .claude/agents, scripts/harness
depends_on: []
---

# HARNESS-120: wide-blast approval needs independent adversarial review

## Objective

Make the approval gate distinguish a local reversible change from a contract change that affects every
PR, release, or other high-blast workflow. HARNESS-119 changed the universal post-merge verifier, but the
guardian required independent review only for new-surface placement and therefore treated adversarial
validation as N/A.

## Plan

- [ ] Define an observable, domain-neutral wide-blast classification owned by one rule.
- [ ] Require an independent proposal/recommendation verdict before approval for that class.
- [ ] Add guardian fixtures proving wide-blast changes fail without the verdict while ordinary local
      changes and existing new-surface placement checks retain their current behavior.
- [ ] Decide how the gate records historical items without retroactively inventing approval evidence.

## Test Plan

- Add focused guardian/scan fixtures for a universal workflow contract, a local reversible change, a
  new surface, and a missing or stale independent verdict.
- Run the focused contract tests, the complete harness contract tier, and `pnpm harness:scan`.

## User Execution Test Scenarios

Not applicable. This changes internal approval governance and its mechanical tests, not a runnable
Robota CLI, TUI, browser, or public SDK surface.
