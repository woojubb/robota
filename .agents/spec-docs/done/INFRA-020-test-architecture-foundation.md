---
status: draft
type: INFRA
tags: [architecture, testing, transport]
---

# INFRA-020: Test architecture foundation — client-side interaction contract + disciplined test framework

Lock the **foundation** the test suite will scale on top of. The test count is small today only
because testing is at an early stage; it must grow large, so the structure decided now is what every
future test inherits. Judged on architecture alone (rework cost and "existing pattern" explicitly set
aside; pre-release, so interfaces in any package may change — [[feedback_no_backward_compat]]).

## Problem

Test infrastructure is shaped by convenience, not by the domain's seams:

1. **The client side of the interaction seam is unmodeled.** `IInteractionChannel`
   (`agent-interface-transport`) is the **framework-side** port (the framework writes events to a
   channel, reads submits). Its **dual — the client side** (submit input, observe the event stream) —
   has **three real implementers** but no shared contract: the in-process programmatic driver
   (`createProgrammaticAgent`/`IProgrammaticAgent`, agent-transport), the remote client
   (`agent-remote-client`), and the (to-be-built) built-binary driver. Each reinvents the same
   "drive + observe" shape; scenarios cannot be written once and run across drivers; the client
   surface drifts per implementer.

2. **The test framework package has no charter, so it risks becoming a grab-bag.**
   `@robota-sdk/agent-testing` (INFRA-016) currently holds one PTY primitive but its name implies "all
   testing"; without a written charter + placement rule, unrelated cross-layer test code will accrete
   and dependency/ownership lines blur.

Reproduction: there is no `IAgentDriver` type to write a driver-agnostic scenario against; and
`agent-testing` has no SPEC charter saying what does and does not belong in it.

## Architecture Review

### Affected Scope

- `packages/agent-interface-transport/src/interaction-contracts.ts` (+ index) — add the client-side
  `IAgentDriver` contract (dual of `IInteractionChannel`) + shared **pure accessors** over the
  `InteractionEvent` stream.
- `packages/agent-transport/src/programmatic/` — `createProgrammaticAgent` returns `IAgentDriver`;
  `IProgrammaticAgent` is **replaced** (not aliased) by the shared contract; accessors delegate to the
  shared helpers (no per-adapter filter logic).
- `packages/agent-testing/` — keep the package as the **general test framework/environment**; write
  its SPEC **charter + placement rule**. The generic PTY runner stays here. No move, no rename.
- `packages/agent-cli/` — a built-binary `IAgentDriver` adapter (spawns the robota binary via the
  agent-testing PTY runner, parses `--output-format stream-json` into `InteractionEvent`s); whole-binary
  E2E lives here.
- `packages/agent-transport-tui/` — rendering tests keep consuming agent-testing's PTY runner; only
  terminal-specific assertions (Ink frames/scrollback) live here.
- (Future, not in this spec) `agent-remote-client` — its client implements `IAgentDriver`.

### The two pillars

**Pillar 1 — model the client-side interaction port (`IAgentDriver`).** The interaction seam has two
sides; only one is modeled. The dual is a **production** contract (remote-client + embedding apps are
non-test clients), not test-only — so it is NOT speculative generality: ≥3 real implementers. It lives
next to `IInteractionChannel` in `agent-interface-transport` (interaction-contract SSOT):

```ts
interface IAgentDriver {
  start(): Promise<void>;
  send(text: string): Promise<void>; // serial: awaits the turn
  queueAction(response: TActionResponse): void;
  readonly events: readonly InteractionEvent[];
  stop(): Promise<void>;
}
// Pure shared accessors over the stream — implemented ONCE, reused by every adapter:
//   assistantReplies(events) / lastAssistantText(events) / toolCalls(events) / errors(events)
```

Accessors are pure functions of `events` → live in the contract package, reused by every adapter; the
per-adapter filter duplication INFRA-019's review flagged becomes structurally impossible.

**Pillar 2 — agent-testing is the disciplined general test framework.** Keep the package and name; a
"test framework/environment" is a cohesive single purpose (like vitest/testing-library). Cohesion is
guaranteed by a written **placement rule** (its SPEC), not by the name. The generic PTY runner is
general test-environment tooling → stays here. Dependency-clean: agent-testing has **zero `@robota-sdk`
runtime deps**, so any consumer (agent-cli, agent-transport-tui) can depend down onto it with no cycle.

**Placement rule (governing principle — written into agent-testing's SPEC):**

- **Contracts** (interfaces) → the relevant `agent-interface-*` package. (Never in agent-testing.)
- **Test doubles** for a contract X → X's owning package `./testing` (canonical fake, no divergent
  forks): scripted provider (agent-core), scripted-session (agent-framework).
- **Driver adapters** → the module owning what they drive: in-process → agent-transport; built CLI
  binary → agent-cli (its own artifact, consistent with no shared CLI factory); remote →
  agent-remote-client.
- **Domain-free test-environment tooling with no other home** (PTY runner, future scenario helpers) →
  `agent-testing`. **No re-export hub** ([[feedback_sdk_not_reexport_all]]): it does not re-export the
  doubles/adapters; authors import those from their owners.
- A module's **own feature tests** live in that module.

### Alternatives Considered

- **Alt A — agent-testing as an undisciplined bucket.** Rejected: accretes cross-layer code; ownership
  blurs. (The fix is the placement rule, not deletion.)
- **Alt B — rename to `agent-pty-harness` / move PTY into agent-transport-tui.** Rejected: "harness" is
  internal repo jargon, wrong for a public general test package; and moving PTY into the TUI couples a
  domain-free primitive to a UI module and forces agent-cli to import PTY from the TUI (against the
  consumer set / dependency direction).
- **Alt C — no client contract; each driver keeps its own shape.** Rejected: the client side is a real
  port with ≥3 implementers; leaving it unmodeled guarantees drift and blocks write-once-run-anywhere
  scenarios — the exact scale problem this foundation must prevent.
- **Alt D (chosen) — `IAgentDriver` in the interface package + agent-testing kept as the disciplined
  general framework (charter + placement rule) + adapters in owning modules.**

### Decision

Alt D. Contradiction-free against every standing invariant: interface package owns contracts; adapters
in owning modules; agent-core stays zero-dep (contract is types-only, agent-testing has zero
`@robota-sdk` deps); agent-cli owns its own driver (no shared CLI factory); test doubles co-locate with
contracts; no re-export hub; no cycle. Minimal structure that scales: one driving contract, one written
rule for where each kind of test artifact lives.

### Resolved decisions (user, GATE-APPROVAL)

1. **Package name**: `@robota-sdk/agent-testing` (kept — the general test framework).
2. **Contract name**: `IAgentDriver`.
3. **Interfaces in other packages may change** as needed (pre-release): `IProgrammaticAgent` is
   replaced by `IAgentDriver`; shared interaction types may be unified across both sides of the seam.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `IInteractionChannel` is the only interaction port; its client dual is
      missing; the PTY runner is the only cross-cutting domain-free test util
- [x] 대안 최소 2개 검토 완료 (A bucket / B harness-rename+move / C no-contract / D chosen)
- [x] 결정 근거 문서화 완료 (real client-side port; cohesion via placement rule not name; dependency-clean leaf)

## Solution (phased; each phase = one PR)

1. **Phase 1 — contract + programmatic conformance + framework charter.**
   `IAgentDriver` + pure accessors in `agent-interface-transport`; `createProgrammaticAgent` returns
   `IAgentDriver` (replace `IProgrammaticAgent`, accessors delegate to shared helpers); write
   `agent-testing` SPEC charter + placement rule.
2. **Phase 2 — agent-cli built-binary driver + cross-fidelity proof.**
   A built-binary `IAgentDriver` in agent-cli (agent-testing PTY runner + stream-json parse); one
   scenario runs on BOTH the programmatic and binary drivers with identical observations; relocate
   whole-binary CLI E2E into agent-cli; keep TUI rendering PTY tests in agent-transport-tui.
3. **(Separate item) TEST-009 rewrite** — agent-cli feature coverage: scenarios target `IAgentDriver`;
   in-process via `startCli`/programmatic, real-binary via the binary driver; cross-fidelity where
   valuable.

## Affected Files

- `packages/agent-interface-transport/src/interaction-contracts.ts` (+ index export)
- `packages/agent-transport/src/programmatic/*`
- `packages/agent-testing/docs/SPEC.md` (charter + placement rule)
- `packages/agent-cli/**` (binary driver + whole-binary E2E)
- `packages/agent-transport-tui/**` (rendering tests unchanged consumption)
- `.agents/project-structure.md` (agent-testing description)

## Completion Criteria

- [x] TC-01: `IAgentDriver` + pure accessors exported from `agent-interface-transport`; accessor unit
      test (`interaction-accessors.test.ts`, 5) passes; typecheck green. (Phase 1)
- [x] TC-02: `createProgrammaticAgent` returns `IAgentDriver`; `IProgrammaticAgent` removed; accessors
      delegate to the shared helpers; agent-transport suite 38 pass. (Phase 1)
- [x] TC-03: `agent-testing/docs/SPEC.md` states the general-framework charter + placement-rule table;
      PTY runner stays; project-structure updated; `harness:scan` green. (Phase 1)
- [x] TC-04: `createBinaryAgentDriver` (agent-cli) drives the real robota binary in print/stream-json;
      `cross-fidelity.bintest.ts` runs one scenario on the programmatic AND binary drivers — both
      observe `CROSS_FIDELITY_OK` identically. (Phase 2)
- [x] TC-05: `agent-transport-tui` `test:pty` 6 pass; agent-cli default suite 141 pass — no regression.
      (Phase 2)
- [x] TC-06: repo-wide typecheck green; `pnpm harness:scan` 33/33; no dependency cycle. (both phases)

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                    | Notes               |
| ----- | --------- | ---------------------------------------------------------------------------------- | ------------------- |
| TC-01 | automated | accessor unit test over a synthetic event array + typecheck                        | pure accessors      |
| TC-02 | automated | agent-transport programmatic suite against `IAgentDriver`                          | conformance, no dup |
| TC-03 | automated | SPEC charter present; `harness:scan` specs/docs-structure                          | discipline written  |
| TC-04 | automated | one scenario via programmatic AND agent-cli binary driver → identical observations | cross-fidelity      |
| TC-05 | automated | agent-transport-tui `test:pty` green                                               | no regression       |
| TC-06 | automated | `pnpm typecheck` + `pnpm harness:scan`                                             | structural gates    |

## User Execution Test Scenarios

Foundational test architecture; product value is a scalable, drift-free test surface. Validated by the
conformance + cross-fidelity tests running green — the same scenario observed identically in-process and
against the built binary is the executable proof the contract is real and the foundation holds.
Evidence: `cross-fidelity.bintest.ts` (Phase 2) drives the **real robota binary** (print/stream-json,
deterministic via `--session-log`) and the in-process programmatic driver through one `IAgentDriver`
scenario; both observe `CROSS_FIDELITY_OK` identically — the executable proof. Phase 1 contract/accessor
unit tests + agent-transport conformance back it.

## Tasks

- [x] `.agents/tasks/completed/INFRA-020.md` — archived (GATE-COMPLETE).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

- Frontmatter `type: INFRA`, `tags: [architecture, testing, transport]`; Problem w/ reproduction;
  Architecture Review 4/4 — 4 alternatives + decision; TC-01–06 + matching Test Plan; Tasks
  placeholder; empty result Evidence Log.
- Result: PASS → `draft` → `review-ready` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

- The design was developed and refined directly with the user across several turns (client-side port
  insight; dependency-direction argument for the leaf; "harness" naming correction). User resolved the
  three open decisions: package name `@robota-sdk/agent-testing` (kept), contract `IAgentDriver`,
  interfaces in any package may change (pre-release). Approval given to proceed phase-by-phase.
- No Architecture Review / type / tags changed after approval.
- Result: PASS → `review-ready` → `approved` → `todo/`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

- Tasks file `.agents/tasks/INFRA-020.md` created; Phase 1 (T1–T4) → TC-01/02/03/06, Phase 2 (T5–T7)
  → TC-04/05/06.
- Result: PASS → `approved` → `in-progress` → `active/`.

### Phase 1 — ✅ complete (PR pending) | 2026-06-28

- **TC-01**: `IAgentDriver` + `IToolCallObservation` + pure accessors (`readAssistantReplies` /
  `readLastAssistantText` / `readToolCalls` / `readErrors`) added to `agent-interface-transport`
  (`interaction-contracts.ts`, exported from index). `interaction-accessors.test.ts` (5 tests) +
  type test pass; interface-transport suite 10 pass.
- **TC-02**: `createProgrammaticAgent` now returns `IAgentDriver`; `IProgrammaticAgent` removed;
  accessors delegate to the shared `read*` helpers (no per-adapter filters). agent-transport suite 38
  pass. `programmatic-driver.test.ts` imports `IAgentDriver` from the contract SSOT.
- **TC-03**: `agent-testing/docs/SPEC.md` rewritten with the general-framework charter + placement-rule
  table; project-structure.md description updated. No re-export hub.
- **TC-06**: full monorepo build + repo-wide typecheck green; `pnpm harness:scan` 33/33.
- Merged to develop via PR #860.

### Phase 2 — ✅ complete | 2026-06-28

- **TC-04**: `createBinaryAgentDriver` (`agent-cli/src/testing/binary-agent-driver.ts`) implements
  `IAgentDriver` by running the built robota binary in print mode with `--output-format stream-json`
  (deterministic via `--session-log`), parsing the event stream. `cross-fidelity.bintest.ts`
  (build-gated `test:bin` project) runs ONE `IAgentDriver` scenario against both the programmatic and
  binary drivers — both observe `CROSS_FIDELITY_OK` identically. 1 test pass.
- **TC-05**: agent-transport-tui `test:pty` 6 pass; agent-cli default suite 141 pass — no regression.
- Scope note: the existing whole-binary `*.ptytest.ts` stay in agent-transport-tui (they assert TUI
  rendering — that module's domain). agent-cli gains its OWN binary driver (behavior, print/stream-json)
  rather than relocating the rendering suites; this is the correct placement, so the "relocate" task was
  resolved as "agent-cli owns a binary driver; rendering stays in TUI" — nothing dropped.
- Mechanism note: the binary driver uses a piped child process (print mode is non-interactive), NOT the
  PTY runner; the PTY runner remains for interactive TUI rendering.
- agent-cli gains `@robota-sdk/agent-interface-transport` as a devDependency (interface types imported
  from their SSOT — interface-imports rule) + a `test:bin` vitest project.

### [GATE-VERIFY] — ✅ PASS | 2026-06-28

- Prior gate: GATE-IMPLEMENT ✅ PASS; status `in-progress` in `active/`.
- All TC-01–06 satisfied across the two phases; interface-transport 10 + agent-transport 38 + agent-cli
  141 + tui `test:pty` 6 + `cross-fidelity.bintest.ts` 1 pass; repo typecheck green; `harness:scan` 33/33.
- Result: PASS → `in-progress` → `verifying`.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-28

- All Completion Criteria `[x]`; every Test Plan row has a test reference. The cross-fidelity test is the
  executable proof that `IAgentDriver` is a real contract (identical observation in-process and on the
  real binary). Tasks archived to `.agents/tasks/completed/INFRA-020.md`.
- Result: PASS → `verifying` → `done`; `active/` → `done/`.

**Foundation laid.** The interaction seam now has both sides modeled (`IInteractionChannel` +
`IAgentDriver`); test doubles live with their contract owners; agent-testing is the disciplined general
test framework (charter + placement rule); agent-cli owns its binary driver. TEST-009 (agent-cli feature
coverage) is rewritten on this foundation as the next item.
