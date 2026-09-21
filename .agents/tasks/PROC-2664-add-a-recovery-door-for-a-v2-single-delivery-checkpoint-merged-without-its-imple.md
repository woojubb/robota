---
title: 'PROC-2664: Add a recovery door for a v2 single-delivery checkpoint merged without its implementation'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-21
priority: high
urgency: soon
area: harness planning-checkpoint contract
depends_on: []
---

# PROC-2664: Add a recovery door for a v2 single-delivery checkpoint merged without its implementation

## Objective

Give a v2 `single`-delivery unit whose planning checkpoint reached the integration base without its
implementation a contract-admitted way to continue, and stop that state from arising unnoticed: bind
the `Delivery mode` declaration to the shape of the pull request that carries the checkpoint, or add
a v2 correction door from `single` to `sequenced`, or a first-form re-anchor for a checkpoint already
on base — one of these, decided by its own recommendation gate.

## Problem

`MANIFEST-2664`'s GATE-IMPLEMENT entry (`checkpoint-evidence:v2`, `gateImplementFirst`,
`deliveryMode: single`) was pushed and merged alone in PR #2792 at `f185015f7`; every gate, the push
hook, and the merge gate passed, because nothing verifies a `single` declaration against the delivery
that actually occurs. On a branch cut from the merged base, `scan-user-execution-plan-order.mjs
--staged` refuses every implementation path (`staged implementation has no planning checkpoint
ancestor`, reproduced 2026-09-21), the continuation checkpoint requires `Delivery mode: sequenced` and
`gate-checkpoint-evidence.mjs:80-86` binds the prior v2 payload's `single` to the current Decision, and
the correction form is v1-only by PROC-031's deliberate exclusion
(`gate-implement-correction-validation.mjs:21-27`; `backlog-execution.md` "forbidden for a v2 first
PASS"). The unit is sealed. Issue #2774's closing comment recorded this exact state as a known
residual with no unit to measure it on; `MANIFEST-2664` is that unit. The recovery taken —
`VERIFIER-2664`, a second Task/spec identity for one approved design — is the alternative PROC-031
rejected for the v1 case ("duplicates the durable owner … hides the missing recovery edge").

## Source Constraints

- The first PASS's raw evidence stays byte-for-byte unchanged; any door is additive (a new form, a
  new binding, or a new gate), never a rewrite of recorded evidence.
- `Delivery mode` remains the Decision's declaration; a door must not let prose alone re-declare it
  without a guardian-judged entry.
- Preserve the v1 correction door and every continuation semantics PROC-026/029/031 and HARNESS-131
  landed.

## Plan

- [ ] TC-01 — Reproduce the sealed state in a fixture: a v2 `single` first PASS merged to the base with
      no implementation, then a later branch staging an implementation path; the scan refuses it.
- [ ] TC-02 — Decide, through the recommendation gate, which door to build (declaration-to-PR binding
      at push/merge time; a v2 `single` → `sequenced` correction form; or a first-form re-anchor) and
      specify it in the paired spec.
- [ ] TC-03 — Implement the door with the gate writer, the checkpoint contract, and the plan-order scan
      in agreement, red-proofed against the fixture from TC-01.
- [ ] TC-04 — Record how `MANIFEST-2664` is completed once the door exists, and retire the
      `Contained — PROC-2664.` notes in `VERIFIER-2664`.

## Test Plan

Fixture repositories under `make-temp.mjs`: a v2 `single` first checkpoint committed and merged to a
base, a later branch with an implementation path; assert the refusal before the door and the admitted
path after it, in the isolated plan-order suite and the checkpoint-evidence tests. No network, no
credential, no state store.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes the repository's planning-checkpoint contract and its harness scripts under
`scripts/harness/` and `.agents/rules/`; no Robota CLI, TUI, browser, SDK, configuration, or
installed-package surface an end user can execute is involved.

## Finding Evidence

- Filed 2026-09-21 as the root item of a `DEPTH VERDICT: FOUNDATIONAL` returned by
  `finding-depth-triager` on `VERIFIER-2664`'s problem statement (orchestrator run
  `r20260921121945`). Repeat trail the triager assembled: HARNESS-131 (continuation form, 2026-08-28),
  PROC-026/029 (v2 contract and `Delivery mode`, 2026-09-02), PROC-031 (v1-only correction form,
  2026-09-02, v2 explicitly excluded), issue #2774 comment 5750809102 (the `single` sealed state
  recorded as residual), MANIFEST-2664 (this instance). Registered on the umbrella issue #2664:
  https://github.com/woojubb/robota/issues/2664#issuecomment-5760461966.
- Containment: `VERIFIER-2664` proceeds as a labelled containment (`Contained — PROC-2664.`) at the
  owner's direction; it duplicates the design's owner only until this item lands.
