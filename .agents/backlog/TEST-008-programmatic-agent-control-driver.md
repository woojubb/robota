---
title: 'TEST-008: programmatic agent-control driver — fully drive the real CLI agent (north star)'
status: todo
created: 2026-06-28
priority: high
urgency: later
area: packages/agent-cli, packages/agent-provider (assembly factory + programmatic adapter + replay provider; consumed by the testing package)
depends_on: [TEST-007]
---

# Programmatic agent-control driver (final target shape)

**North star (user-set, 2026-06-28):** the agent (Claude) must be able to **directly control and freely
drive the real robota CLI agent at will** — boot it, send messages, run any command, observe streamed
responses and state, and assert outcomes — entirely programmatically on a real terminal. This is the
final target shape that the PTY harness (TEST-007) builds toward.

## Why this is the goal

TEST-007 gave us a real-PTY driver that can type into and read from the built CLI (boot, slash
commands, `/shell` handoff). But the agent's **core loop — a real conversation with a model** — cannot
be driven in tests/automation today: the built CLI only accepts real providers (anthropic/openai/qwen/
deepseek), so there is no deterministic way to script a turn without a live API key. That blocks:

- SCREEN-010 TC-02/03 (streaming → commit transition needs a model response).
- Any automated end-to-end test or autonomous operation of the real agent's conversation loop.

## Architecture (grounded in code — ports & adapters)

`IInteractionChannel` (SSOT: `agent-interface-transport/interaction-contracts.ts`) is the **port**
between the **assembly layer** and **transport channels**. Its own doc reserves a programmatic
adapter: `requestAction` — _"Channel decides HOW to present it (Ink dialog, web modal, **programmatic
preset**)."_ So:

- **Port:** `IInteractionChannel` — small contract (`onSubmit` / `write(InteractionEvent)` /
  `requestAction` / `setAvailableCommands` / `setBusy` / `start` / `stop`).
- **Adapters (= transports = 창구):** TUI (Ink), HTTP, WS, MCP — implement the port per medium.
- **Core:** the assembly layer / `InteractiveSession`.

Correction to an earlier note in this doc: a programmatic control adapter is **NOT duplication** and
should **not** "reuse headless" — the headless/print transport is one-shot output, not an interactive
structured-capture channel. A programmatic adapter is the **slot the port explicitly reserved**.

### Two orthogonal axes

- **Transport axis (the north star):** a **programmatic `IInteractionChannel` adapter** — `write()`
  pushes structured events into a buffer the driver reads; `requestAction()` answers from a script;
  the driver calls the registered `onSubmit` directly. In-process, no terminal/network/rendering.
  Drives a **real** model agent.
- **Provider axis (optional, for reproducibility):** a replay/test provider makes model output
  deterministic — only needed for reproducible runs (e.g. SCREEN-010 TC-02/03). Orthogonal to the 창구.

## Ownership & dependency direction (DECIDED 2026-06-28, user)

**The assembly factory is production and must NOT depend on testing. Dependency flows test →
production only — never the reverse.**

- **Assembly factory = production, owned by `agent-cli`.** Extract the CLI's transport-agnostic agent
  assembly (session + command modules + preset + provider wiring) into an exported factory, e.g.
  `createCliAgent(...) → { session, bind(channel) }`. The CLI's own entry point binds it to the TUI
  adapter; `print` mode binds headless; programmatic control binds the programmatic adapter. No
  `transport-cli` package — the CLI is the **application** that assembles and selects an adapter; TUI
  is just one adapter.
- **Programmatic adapter = production** (a real automation/embedding capability, not test-only), so it
  too carries no test dependency.
- **Replay provider = production** (provider axis), consumed by tests; not test-dependent.
- **Testing package (INFRA-016) only CONSUMES** the assembly factory + programmatic adapter + replay
  provider to build scenarios. It depends on them; they never depend on it.

## What (capability)

1. **Transport-agnostic assembly factory** in `agent-cli` (production) — the core enabler.
2. **Programmatic `IInteractionChannel` adapter** (production) + a thin driver API on top
   (`boot()` / `send()` / `command()` / `awaitResponse()` / `snapshot()` / `expectExit()`).
3. **CLI-loadable replay/test provider** (production, provider axis) for deterministic turns; honors
   streaming deltas / tool calls / completion. Respect provider-boundary & naming rules
   ([[feedback_no_product_names]], [[feedback_scoped_package_naming]], API/orchestrator separation).
4. **Unlock SCREEN-010 TC-02/03** by driving a scripted turn through the programmatic adapter +
   replay provider.

## Open design questions (resolve before GATE-WRITE)

- **CLI opt-in for the replay provider:** `--provider replay --cassette <path>` flag vs. settings
  `type`. Must not weaken production provider selection.
- **Cassette format:** reuse TEST-005's recorded format vs. a simpler hand-authored script format.
- **Adapter/driver package home:** the programmatic adapter is production — does it live in
  `agent-cli`, `agent-transport`, or its own small package? (The _driver/scenario_ layer that wraps it
  for tests lives in INFRA-016.)
- **Safety:** the driver must honor the normal permission gates; "drive at will" is for authorized
  automation, not bypassing safety.

## Relationship to other items

- Builds on **TEST-007** (PTY harness — kept for TUI-rendering tests like SCREEN-010).
- **INFRA-016** (testing package) CONSUMES this (one-way dependency).
- Directly unblocks **SCREEN-010 TC-02/03**.

## Test Plan

- Replay provider unit test: scripted cassette produces deterministic streamed deltas + completion.
- PTY E2E: boot the real CLI with the replay provider, `send("hi")`, assert the streamed response
  renders live then commits to scrollback; a multi-turn conversation scrolls as committed history.
- typecheck / lint / `pnpm harness:scan` green; no provider-boundary or naming-rule violations.

## User Execution Test Scenarios

- Prereq: built CLI configured with the replay provider + a cassette.
- Steps: launch the TUI; send a message; observe the scripted streamed response; send another; scroll
  back through the committed conversation.
- Expected: the conversation runs deterministically end-to-end with no network/model key; committed
  turns sit in scrollback, input pinned; matches a real session's behavior.
- Evidence: _to be filled after implementation._
