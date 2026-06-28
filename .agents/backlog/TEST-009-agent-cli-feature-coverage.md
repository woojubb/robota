---
title: 'TEST-009: agent-cli feature coverage on the INFRA-020 test foundation'
status: in-progress
created: 2026-06-28
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-transport, packages/agent-testing
depends_on: [INFRA-020, TEST-007, TEST-008]
---

# agent-cli feature coverage on the INFRA-020 foundation

Build out comprehensive, deterministic coverage of agent-cli's user-facing surface using the test
foundation laid in INFRA-020. The test count is small today because testing is early; this item is the
first large build-out on the foundation, so it also validates that the foundation is ergonomic.

## Foundation it builds on (INFRA-020)

- **`IAgentDriver`** (`@robota-sdk/agent-interface-transport`) — the client-side drive+observe contract,
  with two implementers: `createProgrammaticAgent` (in-process, agent-transport) and
  `createBinaryAgentDriver` (built robota binary via print/stream-json, agent-cli). Shared `read*`
  accessors derive replies/tool-calls/errors from the event stream.
- **`startCli({ providerDefinitions })`** + `createScriptedProvider` — agent-cli's own self-test entry
  (drives the real CLI assembly headlessly, deterministically). This is how agent-cli tests itself
  ([[feedback_no_shared_cli_factory]]).
- **Determinism**: scripted provider + `--session-log` replay — no model key, no network.

## Vehicle per surface (which tool tests what)

| Surface                                                                        | Vehicle                                                 | Why                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Headless flag matrix, output formats, exit codes, tool-loop, session semantics | `startCli` + scripted provider (`scripted-e2e.test.ts`) | exercises the real CLI assembly + flag parsing in-process; fully deterministic, no build |
| Conversation / slash-command flows where cross-fidelity matters                | `IAgentDriver` scenario (programmatic + binary)         | one scenario, two fidelities — in-process and real binary                                |
| Interactive TUI rendering (scrollback, statusline, multiline, autocomplete)    | PTY (`*.ptytest.ts`, agent-transport-tui)               | terminal-rendering is the TUI module's domain                                            |

## Coverage plan (phased; each phase = one PR; gaps from the inventory)

### Phase 1 — headless flag matrix (`startCli` + scripted provider)

Highest value, deterministic, no build. Assert against the captured provider request / output / exit:

- `--goal` + `--goal-max-iterations` (autonomous loop runs; stops at the bound / on satisfied).
- `--model` override → reflected in the provider request / session config.
- `--language` → language directive present in the system message.
- `--system-prompt` / `--append-system-prompt` → replace vs append in the model request.
- `--task-file` → file content appended to the system prompt.
- `--json-schema` → print output parses as JSON and conforms.
- `--allowed-tools` allowlist → a tool outside the list is denied (mirror the denylist test).
- `--permission-mode acceptEdits` / `bypassPermissions` → edit behavior per mode.
- `-r <id>` resume by id (headless) → prior conversation restored into the request.

### Phase 2 — conversation / slash-command flows (`IAgentDriver`, cross-fidelity where useful)

Drive via the programmatic driver (and, for a representative subset, the binary driver) + scripted/
replay provider; assert on the `InteractionEvent` stream via the shared accessors:

- multi-turn conversation context carried across `send`s.
- representative slash commands that produce observable results (`/help`, `/clear`, `/mode`, `/model`,
  `/cost`, `/compact`), using `queueAction` for disambiguation.
- one flagship scenario run cross-fidelity (programmatic + binary) as a standing guard.

### Phase 3 — interactive TUI (PTY, agent-transport-tui)

Terminal-only behavior the headless paths can't observe:

- `--goal` progress rendering (commits to scrollback, input pinned).
- `/preset` / `/mode` reflected in the statusline; multiline input / paste boundary.
- (keep green: `/shell`, `/editor`, `/help` autocomplete, `/exit`, replay.)

### Phase 4 — foundation feedback loop

Log any agent-cli behavior the foundation can't drive (a missing `IAgentDriver` capability, an
unparsed stream-json event, a PTY assertion the harness can't make). Each becomes a small
foundation-enrichment follow-up (INFRA-\*) — never an in-test hack. This is the explicit "maximize the
framework" loop.

## Progress

### Phase 1 — ✅ done | 2026-06-28

Headless flag matrix via `startCli` + scripted provider (`scripted-e2e.test.ts`):

- `--system-prompt` → custom system instruction present in the model request.
- `--append-system-prompt` → appended marker present and the base system prompt retained.
- `--task-file` → file content appended to the system prompt.
- `--allowed-tools` → **finding (Phase-4 loop)**: this is an AUTO-APPROVE list (`create-session.ts`
  maps it to `Name(*)` permission patterns), NOT a hard allowlist; `--denied-tools` is the hard block.
  Test corrected to assert the real semantics — under `--permission-mode default`, an auto-approved tool
  runs while a non-approved one is denied. (No bug; the initial test asserted wrong semantics.)
- (`--goal` / `--goal-max-iterations`, output formats, `-c`/`--fork-session` resume already covered.)
- Evidence: agent-cli suite 145 pass (+4); typecheck + `pnpm harness:scan` 33/33.

Phases 2–4 follow as separate PRs.

## Test Plan

Each phase lands as a focused PR with its tests green: `pnpm --filter @robota-sdk/agent-cli test`
(scripted-e2e + programmatic), `test:bin` (built-binary cross-fidelity), `test:pty` (TUI). `pnpm
typecheck` / `pnpm lint` / `pnpm harness:scan` green per PR. New PTY/bin tests stay serial
(`pool: 'forks'`) in their build-gated projects; a CI-flaky scenario is gated + `log()`-ged, never
silently skipped. A coverage delta is reported per phase.

## User Execution Test Scenarios

agent-facing test infrastructure; product value is regression protection for agent-cli. Validated by
the new tests running green in CI and locally — each phase's tests ARE the executable scenarios
exercising the real CLI (via `startCli`, the binary driver, or PTY). Evidence: per-phase, recorded on
each phase's PR and summarized here at done.

## Notes

- Determinism is absolute: scripted/replay providers only, no live keys/network.
- Respect boundaries ([[feedback_no_shared_cli_factory]], API/orchestrator separation); shell/editor
  specifics belong to the consumer command modules, not the harness.
- Supersedes the pre-foundation TEST-009 plan (closed PR #859).
