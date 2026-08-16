---
name: wiring-orchestration
description: Thin orchestration for wiring a harness artifact — a skill, agent, rule or scan — into the places that make it reachable. It holds NO wiring policy: it sequences wiring-worker then wiring-guardian, routes on the guardian's verdict, and repeats until PASS. Every judgement lives in the agents. Use whenever an artifact has been authored and must become invocable, and after any change that could have broken a registration.
---

# Wiring Orchestration

A skill that is not wired is not invoked. Wiring that is not verified is not wiring.

This file sequences two roles and holds no policy of its own. What counts as a touchpoint, and what
counts as evidence that a registration check could have failed, are owned by the agents — not
restated here, because a second copy is a second answer waiting to disagree.

## Rule Anchor

- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — worker produces, guardian
  judges, orchestrator routes. `:21`: a role that both produces and judges violates the rule; split it.
- [lesson-to-harness](../lesson-to-harness/SKILL.md) step 6 — no partial wiring.
- [orchestration-map.md](../../specs/orchestration-map.md) — the registry this pipeline appears in.

## Sequence

1. **`wiring-worker`** — wires the artifact. Produces only; issues no verdict.
2. **`wiring-guardian`** — judges. Emits `GATE VERDICT: PASS | FAIL | NON-COMPLIANCE`.
3. **Route on the verdict:**
   - `PASS` → done.
   - `FAIL` → back to the worker with the absent touchpoints. Repeat.
   - `NON-COMPLIANCE` → **do not route back to the worker.** The touchpoints are present; what is
     missing is evidence the enforcing check could have gone red. That is a gap in the check, not in
     the wiring, and re-running the worker cannot close it. Escalate: either add the missing fixture
     (which is HARNESS-098's floor) or record the obstacle and the tracked item.

## Why the guardian's second question is not optional

A guardian that confirms only "the name appears in the index" is an unfalsifiable check occupying the
wiring-verification slot — the same defect it was installed to catch, one layer up. The
`NON-COMPLIANCE` branch above exists so that outcome has somewhere to go other than a green.

## Stop Conditions

- The worker reports a touchpoint it cannot complete → stop and surface the obstacle; do not loop.
- Two consecutive `FAIL` verdicts naming the same touchpoint → stop. The worker cannot wire it, and
  repeating is not progress.
- `NON-COMPLIANCE` → stop and escalate per the routing above. Never convert it to a PASS by re-running.
