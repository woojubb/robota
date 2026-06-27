---
title: "TEST-003: Framework-level functional test harness — the agent's standard E2E for any feature"
status: todo
created: 2026-06-27
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-transport, .agents/rules, .agents/skills
depends_on: []
---

# Framework-level functional test harness (agent-facing)

Build a reusable, deterministic, fully-automated harness that exercises a **real**
`InteractiveSession` — real agent loop, real tools, real persistence, real events — driven by a
scripted provider (no CLI, no network, no live LLM), so that **every feature added at the framework
level can be functionally verified by the agent**. Add the testing-layering policy that makes this
the default, so functional E2E is never skipped again with the excuse "the CLI can't be E2E'd".

This is **infrastructure the agent uses**, not an end-user feature.

## Why

`agent-cli` is a thin wrapper: it parses args, wires transports, and renders the TUI. It owns **no
feature logic**. Every capability the CLI exposes is really \*\*`agent-framework` (`InteractiveSession`)

- the feature\*\*. Therefore:

* The product surface that must be functionally tested is `InteractiveSession`, not the CLI.
* "A feature is hard to E2E through the CLI" is **not** a valid reason to skip functional
  verification — the same feature is fully drivable at the framework level.
* CLI tests should be scoped to thin-wrapper / TUI concerns only (arg parsing, flag→option wiring,
  TUI rendering), not feature behaviour.

Today this is not enforced and the building blocks are incomplete, so functional E2E keeps landing
at the CLI layer (or gets skipped). GOAL-001 is the latest example: its real-stack E2E had to be
written through `startCli` because no framework-level functional harness exists.

## Current building blocks (grounded in the code)

- `createScriptedProvider` (`@robota-sdk/agent-transport/testing`, `scripted-provider.ts`) replays
  declared turns through the **real** stack and is deterministic — but it is currently consumed only
  via `startCli` (`packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts`), i.e. CLI-coupled.
- `createTestInteractiveSession` (`packages/agent-framework/src/testing/`) is a **stub**: every
  method returns a canned value. It cannot run the real agent loop, so it cannot prove a feature
  actually works — only that wiring type-checks.
- **Missing:** anything that builds a real `InteractiveSession` wired to a scripted/deterministic
  provider at the framework level, with ergonomic assertions, in an isolated workspace.

## What

1. **A framework-level functional session harness** (agent-facing test kit) that:
   - constructs a **real** `InteractiveSession` (real loop, builtin tools, persistence, events),
   - is backed by a deterministic scripted provider (declared turns: text + tool calls),
   - runs in an isolated temp `cwd`/home with optional seed files,
   - exposes ergonomic helpers to drive and assert: submit a prompt and await `complete`; drive a
     goal (`setGoal`) to a stop; capture emitted events; read the resulting history, session record,
     and on-disk files; and inspect the tool calls the agent made.
2. **A testing-layering policy** (a rule in `.agents/rules/`): feature behaviour MUST have a
   framework-level functional test using this harness; `agent-cli` tests cover only thin-wrapper /
   TUI concerns; "CLI can't be E2E'd" is explicitly rejected as a reason to skip functional
   verification. A backlog's Test Plan / User Execution gate is satisfiable at the framework level.
3. **A skill** documenting the harness so future agent sessions discover and use it by default.
4. **A reference functional test**: port GOAL-001's behaviour down to a framework-level functional
   test using the harness (the canonical example), proving the harness covers a non-trivial feature.
5. **(Optional, to confirm) mechanical enforcement**: a `harness:scan` check that flags a new
   framework capability lacking a functional test, so the skip-E2E regression can't recur silently.

## Design decisions to confirm (BEFORE implementation)

1. **Harness location & layering.** The harness belongs at the framework level, but the scripted
   provider currently lives in `agent-transport/testing`, and `agent-framework` must not depend on
   `agent-transport` (wrong direction). Options:
   - (a) **Relocate the deterministic scripted-provider SSOT to a framework-reachable testing module**
     (e.g. `agent-framework/testing` or an `agent-core/testing` subpath, since the provider only
     implements `IAIProvider`), and have `agent-transport/testing` re-export it. The harness then
     lives in `agent-framework/testing` with no reverse dep. _(recommended)_
   - (b) Keep the provider in `agent-transport` and put the harness in a separate test-only package.
   - (c) Duplicate a minimal scripted provider in framework testing (rejected — SSOT violation).
2. **Harness API shape.** A single factory (e.g. `createScriptedInteractiveSession({ turns, cwd?,
files?, ... })`) returning the real session plus an assertions facade, vs. a small set of
   composable helpers. Confirm the surface so it is ergonomic for agent-authored tests.
3. **Enforcement strictness.** Add a mechanical scan now (flag framework capabilities without a
   functional test), rely on the rule + skill only, or both. Confirm.
4. **Retrofit scope.** Port GOAL-001 as the reference now; decide whether to retrofit other recent
   framework features in this item or open follow-ups.

**Process gate:** the concrete design note (chosen location, the exact harness API, the rule text,
and the enforcement decision) is confirmed before implementation, per the spec-before-code and
design-confirmation rules. Relevant SPEC.md (agent-framework `testing` surface) is updated as SSOT.

## Done When

- A framework-level functional harness builds and drives a **real** `InteractiveSession` via a
  scripted provider, with assertion helpers, in an isolated workspace.
- A reference functional test (GOAL-001 behaviour) runs entirely at the framework level — no
  `startCli`, no live LLM — and passes deterministically.
- The testing-layering rule is added and linked from the rules index; the skill documents the
  harness; CLI feature E2E can be expressed at the framework level.
- (If chosen) the mechanical enforcement scan is green and wired into `harness:scan`.
- typecheck + lint + tests + `pnpm harness:scan` all green; no layering violation (one-way deps).

## Test Plan

- The harness validates itself: the reference functional test (a real scripted session that runs a
  multi-turn flow with tool calls and asserts history + on-disk file changes + emitted events) is
  the primary proof. Add a focused test that the harness isolates workspace state between cases.
- Layering: confirm `agent-framework` gains no dependency on `agent-transport` (dependency-direction
  scan stays green).
- `pnpm harness:scan`, full `pnpm typecheck`, lint, and the touched packages' test suites.

## User Execution Test Scenarios

Not applicable — this is agent-facing internal test infrastructure with no user-facing product
behaviour. The deliverable is validated by its own reference functional test passing (recorded as
Test Plan evidence), not by a product-surface scenario.
