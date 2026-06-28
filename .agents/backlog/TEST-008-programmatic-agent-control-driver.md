---
title: 'TEST-008: programmatic agent-control driver — fully drive the real CLI agent (north star)'
status: todo
created: 2026-06-28
priority: high
urgency: later
area: packages/agent-transport-tui, packages/agent-cli, packages/agent-provider
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

## What (capability)

1. **CLI-loadable replay/test provider.** A provider the built CLI can select via settings
   (`type: 'replay'` or similar) that plays back a scripted/recorded transcript (cassette) instead of
   calling a network model — the deterministic counterpart of the framework's existing record/replay
   testing provider (TEST-005), but reachable from the **real binary**. Honors streaming
   (text deltas), tool calls, and completion so the real TUI renders a genuine turn.
   - Respect the provider boundary / naming rules ([[feedback_no_product_names]],
     [[feedback_scoped_package_naming]]) and the API/orchestrator separation.
2. **Agent-control driver API** (on top of the TEST-007 `spawnPty`/`spawnTui` harness): a high-level
   surface to drive the agent — `boot()`, `send(message)`, `command(name, args)`, `awaitResponse()`,
   `snapshot()`, `expectExit()` — so a test or the agent itself can operate the real CLI like a user.
3. **Unlock SCREEN-010 TC-02/03**: with a replay provider, drive a scripted turn and assert the
   streaming message renders in the live region then commits once to `<Static>` scrollback.

## Open design questions (resolve before GATE-WRITE)

- **Where does the replay provider live?** A published provider vs. a test-only artifact loaded by the
  CLI in a test/dev mode. Interacts with INFRA-016 (dedicated testing package) — the driver + cassette
  tooling likely belong there.
- **How does the CLI opt in?** Settings `type`, an env flag, or a `--provider replay --cassette <path>`
  CLI flag. Must not weaken production provider selection.
- **Cassette format / source**: reuse TEST-005's recorded format, or a simpler scripted format for
  hand-authored turns.
- **Safety**: the driver must never enable destructive autonomous actions without the normal permission
  gates; "drive at will" is for authorized testing/automation, not bypassing safety.

## Relationship to other items

- Builds on **TEST-007** (PTY harness) — the foundation.
- Likely **homed in / co-designed with INFRA-016** (dedicated testing package).
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
