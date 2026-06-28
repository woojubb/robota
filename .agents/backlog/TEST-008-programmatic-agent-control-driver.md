---
title: 'TEST-008: programmatic agent-control driver — fully drive the real CLI agent (north star)'
status: largely-done
created: 2026-06-28
priority: high
urgency: later
area: packages/agent-cli, packages/agent-provider (assembly factory + programmatic adapter + replay provider; consumed by the testing package)
depends_on: [TEST-007]
---

# Programmatic agent-control driver (final target shape)

> **Status update (2026-06-28): north star reached.** All three enabling axes shipped:
>
> - **Replay provider** (provider axis) — `@robota-sdk/agent-provider-replay` / `ReplayProvider`
>   (INFRA-017, done).
> - **CLI replay flag** — `robota --session-log <path>` drives a deterministic conversation through the
>   built binary (INFRA-018, done; unblocked SCREEN-010 TC-02/03).
> - **Programmatic in-process driver** (transport axis) — `createProgrammaticAgent` +
>   `ProgrammaticInteractionChannel` in `@robota-sdk/agent-transport/programmatic` (INFRA-019, done):
>   `start`/`send`/`stop` drives a real `InteractiveSession` and reads assistant replies / tool calls /
>   errors as data, no terminal.
>
> **Remaining (optional follow-up, not required for the north star):** the transport-agnostic CLI
> **assembly factory** `createCliAgent(...)` — extract the CLI's exact preset/provider/command wiring so
> the programmatic driver can run with production-parity composition (today it wires session +
> commandModules directly). Invasive CLI-startup refactor; sequence when production-parity in-process
> driving is actually needed (e.g. INFRA-016 testing-package scenarios). Tracked below under "What" #1.

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
3. **Session-log-driven replay provider** (production, provider axis) for deterministic turns; honors
   streaming deltas / tool calls / completion. Respect provider-boundary & naming rules
   ([[feedback_no_product_names]], [[feedback_scoped_package_naming]], API/orchestrator separation).
4. **Unlock SCREEN-010 TC-02/03** by driving a scripted turn through the programmatic adapter +
   replay provider.

## Recording substrate = the session log (DECIDED 2026-06-28, user)

**Design direction: the session log is the single recording substrate — no separate cassette format.**
The CLI already writes a JSONL session log (`FileSessionLogger`: `{timestamp, sessionId, event,
...data}`, with external-payload offload + secret redaction) and already has replay-validation
(`validateCurrentSessionReplayLog` / `ISessionReplayValidationResult`). So:

- The **replay provider reads the session log** and re-emits each recorded turn; recording = just
  running a session and keeping its log.
- **Converge TEST-005's bespoke cassette format into the session log** — one substrate for session
  persistence + replay-validation + record/replay testing.

### Resume-completeness ⟹ replay substrate (user, 2026-06-28)

The session log is **designed for perfect session resume**, i.e. it already captures the full
conversation state — user inputs, assistant outputs, and tool calls/results — enough to restore
context and continue. Replay rides on that same data:

- **The replay provider re-emits the recorded assistant turns** (assistant message + tool calls) from
  the resume-capable log, acting as the model. Streaming deltas for the TUI can be **synthesized**
  from the final assistant message (chunked) — they need not be byte-identical to the original to
  exercise the streaming→commit path (SCREEN-010 TC-02/03).
- So **resume-completeness largely implies replay-completeness.** The first task is a
  **replay-coverage audit**: confirm the resume-level data lets the provider re-emit turns
  deterministically; only add a log event if something genuinely required is missing (enrichment, not
  a new format). `validateCurrentSessionReplayLog` is the completeness gate.

> **Enrichment rule (user, 2026-06-28):** if the log lacks anything replay needs, **enrich the log** —
> never add a parallel format. Secrets stay redacted; model outputs are loggable.

### Replay-coverage audit result (2026-06-28): log is already replay-complete — no enrichment needed

`FileSessionLogger` already records the full provider output stream (`session-run.ts`,
`permission-enforcer.ts`):

- `user { content }` — input
- `text_delta { delta }` — **streaming deltas** (byte-exact streaming replay possible, not just synth)
- `tool_call { tool, args }` + `tool_result { … }` — tool execution
- `assistant { content, history: postHistory }` — final response + the **full post-turn history**
  (the resume substrate)
- `context` / `error` / provider events

So a replay provider can re-emit each turn (`text_delta → tool_call → assistant`) verbatim from the
log. **No session-log enrichment is required.** Remaining TEST-008 work narrows to: the replay
provider (reads the log JSONL), the programmatic `IInteractionChannel` adapter + driver, and the
transport-agnostic assembly factory + CLI opt-in.

## Open design questions (resolve before GATE-WRITE)

- **CLI opt-in for the replay provider:** `--provider replay --session-log <path>` (replay from a
  recorded session log) vs. settings `type`. Must not weaken production provider selection.
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

- Replay-coverage audit + (if needed) session-log enrichment, gated by
  `validateCurrentSessionReplayLog` proving a log is replay-complete.
- Replay provider unit test: a recorded session log replays deterministic turns (re-emitted assistant
  message + tool calls; streaming synthesized from the final message).
- PTY E2E: boot the real CLI with the replay provider over a session log, `send("hi")`, assert the
  streamed response renders live then commits to scrollback; a multi-turn conversation scrolls as
  committed history.
- typecheck / lint / `pnpm harness:scan` green; no provider-boundary or naming-rule violations.

## User Execution Test Scenarios

- Prereq: built CLI configured to replay from a recorded session log.
- Steps: launch the TUI; send a message; observe the scripted streamed response; send another; scroll
  back through the committed conversation.
- Expected: the conversation runs deterministically end-to-end with no network/model key; committed
  turns sit in scrollback, input pinned; matches a real session's behavior.
- Evidence: _to be filled after implementation._
