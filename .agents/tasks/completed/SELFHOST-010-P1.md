# SELFHOST-010 P1 — computer-use driver port + neutral perceive→act tool (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-010-computer-use.md`](../spec-docs/active/SELFHOST-010-computer-use.md)
(EPIC; P1 = this slice; design-gated prior batch, grounding re-verified 2026-07-19). Mirror the `agent-tools/src/sandbox`
port precedent. NO heavy browser SDK in `agent-tools`. Commit per logical slice.

## Design (approved, P1)

- **agent-tools** `src/computer-use/types.ts` (new): `IComputerDriver` port — `screenshot()` (perceive) + mutating
  actions (`click`/`double_click`/`type`/`keypress`/`scroll`/`drag`/`wait`/`takeover`) per the perceive→act contract +
  `IComputerToolOptions { driver? }` (mirror `sandbox/types.ts`). A duck-typed `IBrowserPageAdapter` for the (P2)
  zero-dep reference adapter — no browser SDK import.
- **agent-tools** `ComputerView` (perceive; returns a screenshot) + `Computer` (mutating action) tool factory +
  `ScriptedComputerDriver` (deterministic, no browser). Tools join the default set **adapter-gated** (absent driver ⇒
  no-op/absent, NO host fallback).
- **agent-core permissions**: register `ComputerView` (auto — read-only like `Read`) + `Computer` (approve in default,
  deny in plan — mutating) as two KNOWN tools through the EXISTING `PermissionEnforcer`; no new approval path.
- **assembly**: thread the `driver` through the assembly layer like `sandboxClient` (`ICreateSessionOptions`);
  product supplies the concrete driver + target env.
- **takeover**: the `takeover` action suspends the action loop + pauses perception until resume (no screenshot during
  credential entry).

## Status

**DONE (2026-07-19).** All slices S1–S6 implemented + green; TC-01..TC-08 satisfied at the unit/functional level.
See the spec's Evidence Log `[P1 IMPLEMENTED]` entry for files + verification. Real-browser agent-run verification
remains the pending P2 deliverable.

## Slices (each green + committed)

1. **S1 — port + contract types** (`computer-use/types.ts`, mirror sandbox/types.ts) + `ScriptedComputerDriver`.
2. **S2 — tool factory** `ComputerView`/`Computer` executing actions through the injected driver (TC-01).
3. **S3 — permission wiring** (agent-core two known tools: ComputerView auto, Computer approve/deny) (TC-02/07/08).
4. **S4 — takeover** loop-suspension + perception-pause (TC-03).
5. **S5 — assembly threading + adapter-gating** (like sandboxClient; absent driver ⇒ no-op, no host fallback) (TC-04).
6. **S6 — swap + neutrality** (the scripted test-support driver + a 2nd stub driver both satisfy the port; no browser SDK / no target in
   `agent-tools`) (TC-05/06) + docs (agent-tools + agent-core SPEC). File the mechanical agent-tools neutrality-floor
   follow-up (per TC-06, shared with SELFHOST-003's noted gap / HARNESS-027).

## Test Plan

Unit/functional against `ScriptedComputerDriver`: TC-01 (round-trip perceive/act), TC-02 (perceive auto / mutate
approve-in-default, deny-in-plan via PermissionEnforcer — no new path), TC-03 (takeover suspends loop + pauses
perception), TC-04 (assembly threading + adapter-gating, no host fallback), TC-05 (driver swap needs no agent-tools
change; PageComputerDriver imports no browser SDK), TC-06 (neutrality grep/review), TC-07 (no auto mutating action
w/o approval except bypassPermissions), TC-08 (read-only perception works in plan mode).
Regression: `pnpm --filter @robota-sdk/agent-tools --filter @robota-sdk/agent-core test`, typecheck, lint,
`pnpm harness:scan`.
**Agent-run browser verification: DEFERRED to P2** (PageComputerDriver vs a real page under xvfb) — named per the
capability-reachability rule; P1 is a scripted-test-support-driver library seam.
