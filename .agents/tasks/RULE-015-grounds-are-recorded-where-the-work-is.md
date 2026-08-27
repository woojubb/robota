---
title: 'RULE-015: a ground is recorded where the work is, and an incident closes on demonstrated prevention'
issue: https://github.com/woojubb/robota/issues/2384
status: todo
created: 2026-08-27
priority: high
urgency: now
area: .agents/rules, AGENTS.md, scripts/harness
depends_on: []
---

# RULE-015: a ground is recorded where the work is, and an incident closes on demonstrated prevention

## Objective

Two principles the owner stated on 2026-08-27, currently living nowhere a future session can read:

1. **A ground is recorded on the artifact it justifies, at the moment of acting.** When an action needs
   a ground — a push into an open pull request, a rebase, a status change, a gate entry — the reason is
   written on that pull request when the action is taken, not reconstructed afterwards and not held in
   a session.
2. **An incident does not close on a root cause plus a written prevention. It closes on a demonstrated
   one** — an after-action record showing the recurrence is actually blocked, with the control that
   distinguishes "blocked" from "never exercised".

They were transmitted to three sessions by message. **That is the defect this Task exists to fix**:
a rule delivered as a message binds one session for one day. The owner's correction was exact — the
rule belongs in the repository, and everyone reads it from there.

Source: https://github.com/woojubb/robota/issues/2384

## Plan

- [ ] State both principles in `.agents/rules/` under the owner that already governs each: grounds in
      `git-branch.md` (which already defines the three named grounds), demonstration in
      `enforcement-architecture.md` (which already owns "silence is not success").
- [ ] Route them from `AGENTS.md` if the routing table does not already reach them.
- [ ] **Enforce, do not merely state.** Issue #2188 measured nine dependency rules enforced by a scan
      and stated in no document; this is the same defect reversed, and prose alone reproduces it.
- [ ] Red-proof each enforcement: a case that violates the rule must fail, and a case that complies
      must pass. An enforcement with only the passing half is the shape of issue #2384's guard.
- [ ] After-action: demonstrate the rule's own prevention, per principle 2, rather than asserting it.

## Recommendation Gate

- Finding depth: pending — to be recorded before implementation.
- Proposal review: pending — to be recorded before implementation.

## Test Plan

- For principle 1: a fixture pull request whose head moved after a zero-findings verdict with no ground
  recorded must fail; one carrying the ground must pass.
- For principle 2: an incident record with a cause and a prevention but no demonstration must fail; one
  carrying the demonstration and its control must pass.
- Both directions in every case. A fixture set containing only compliant cases tests nothing.

## Notes

**The occasion.** Pull request #2374 took two pushes after zero-findings verdicts. The guard that
refuses exactly that landed on develop seven hours earlier and was absent from every tree that pushed —
git hooks run from the checked-out working tree. Swept over 18 remote branches: 3 carry the guard,
15 do not.

**One correction to how that sweep was reported**, from robota-2-50, and it belongs here because it is
the same class of error the rule addresses: the discriminator is **whether the branch was cut after
`79906fda7`**, not how far behind it is. A branch can be zero behind and still lack the guard. The
file's content is the measurement; the distance is a correlate that happened to sort the same way.
