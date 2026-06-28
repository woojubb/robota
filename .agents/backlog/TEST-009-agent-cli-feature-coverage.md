---
title: 'TEST-009: agent-cli feature coverage via the new test framework (PTY + programmatic + scripted)'
status: todo
created: 2026-06-28
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-transport-tui, packages/agent-transport, packages/agent-testing
depends_on: [TEST-007, TEST-008]
---

# agent-cli feature coverage via the new test framework

Use the test framework built in TEST-007 (`@robota-sdk/agent-testing` PTY harness) + TEST-008
(INFRA-019 `createProgrammaticAgent` in-process driver) + the deterministic providers
(`createScriptedProvider`, INFRA-017/018 replay) to cover agent-cli's user-facing surface end to end —
**exercising the framework's intrinsic capabilities to the fullest**, not just a smoke pass.

## Motivation

agent-cli has a wide surface — ~30 CLI flags, 9 run modes, ~28 slash commands — but the automated
coverage is uneven: print-mode fundamentals, session resume/fork, output formats, and a TUI boot
smoke are covered; large parts of the headless flag matrix, the autonomous goal loop, and most
individual slash commands have **no** end-to-end test. We now have three complementary drivers that
can close this deterministically (no model key, no network), so the gap is addressable.

This item is also the **proving ground for the framework itself**: writing real feature tests is how
we validate that the PTY harness + programmatic driver are ergonomic and complete, and surfaces any
missing capability as a concrete follow-up (enrich the framework, never work around it).

## Tooling decision — which driver for what

| Driver                                                                            | Vehicle                                            | Best-fit coverage                                                                                                                                                |
| --------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **scripted-e2e** (`startCli({ providerDefinitions })` + `createScriptedProvider`) | the **real CLI assembly**, headless, deterministic | headless flag matrix, output formats, tool-loop flows, session semantics, exit codes — the CLI's own preset/provider/command wiring                              |
| **PTY harness** (`spawnTui` / built binary, `*.ptytest.ts`)                       | the **built binary** in a real pseudo-terminal     | interactive TUI: slash commands, autocomplete, goal-loop progress rendering, multiline input, statusline, terminal handoff                                       |
| **programmatic driver** (`createProgrammaticAgent`)                               | in-process framework session, structured events    | command/tool/event flows assembled from `@robota-sdk/agent-command` modules directly; fast assertions on `events`/`toolCalls`/`assistantReplies` without a build |
| **replay** (`--session-log`)                                                      | built binary, recorded log                         | deterministic-conversation regression + scrollback/streaming behavior                                                                                            |

**Constraint ([[feedback_no_shared_cli_factory]]):** agent-cli-specific wiring (preset/provider
selection, the exact registered command set) is tested through the **real CLI entry** (`startCli`
headless, or the built binary via PTY) — NOT by extracting a shared `createCliAgent` factory. The
programmatic driver covers transport/framework-level command+tool flows where the test assembles the
needed command modules itself.

## Coverage plan (phased; each phase = one focused PR)

### Phase 1 — headless flag matrix (scripted-e2e, extend `scripted-e2e.test.ts`)

Highest value, fully deterministic, no build. Assert against the captured provider request / output:

- `--goal` + `--goal-max-iterations`: goal loop runs, stops at the iteration bound (exit 2) or on
  satisfied; progress surfaced. (GOAL-001 path — currently untested E2E.)
- `--model <m>` override → appears in the provider request metadata / session config.
- `--provider <p>` override (headless) → selected provider used.
- `--language <l>` → language directive present in the system message.
- `--system-prompt` / `--append-system-prompt` → replace vs append verified in the model request.
- `--task-file <path>` → file content appended to the system prompt.
- `--json-schema <schema>` → print output parses as JSON and conforms.
- `--allowed-tools` allowlist → a tool outside the list is denied (mirror the existing denylist test).
- `--permission-mode acceptEdits` / `bypassPermissions` → edit behavior per mode.
- `-r <id>` resume by id (headless) → prior conversation restored into the request.

### Phase 2 — slash commands (programmatic driver, in-process)

Drive `createProgrammaticAgent` with the relevant `@robota-sdk/agent-command` modules + scripted
provider; assert `command-result` / state events. Cover the high-traffic commands:

- `/help`, `/clear`, `/rename`, `/mode`, `/model`, `/preset`, `/cost`, `/compact`, `/memory`
  (save/load), `/context` (add/remove), `/language`.
- For each: the command executes, produces the expected result event, and mutates session state as
  declared. `requestAction`-driven commands use `queueAction` to answer disambiguation.

### Phase 3 — interactive TUI (PTY harness, built binary, `*.ptytest.ts`)

Terminal-dependent behavior the headless paths can't observe:

- `--goal` progress **rendering** in the TUI (commits to scrollback, input pinned).
- `/preset <id>` and `/mode` switching reflected in the statusline.
- Multiline input / paste handling (bracketed-paste boundary).
- (Already covered, keep green: `/shell`, `/editor` handoff, `/help` autocomplete, `/exit`, replay.)

### Phase 4 — framework-capability gaps (enrich, don't work around)

As Phases 1–3 are written, log any agent-cli behavior that **cannot** be driven by the current
framework (e.g. a slash command needing host adapters the programmatic driver doesn't wire, or a
PTY assertion the harness can't make). Each becomes a small framework-enrichment follow-up
(INFRA-\*), never an in-test hack. This phase is the explicit "maximize the framework" feedback loop.

## Test Plan

- Each phase lands as a focused PR with its tests green: `pnpm --filter @robota-sdk/agent-cli test`
  (scripted-e2e), the programmatic suite in agent-transport, and `test:pty` (built binary) for the
  PTY phase. `pnpm typecheck` / `pnpm lint` / `pnpm harness:scan` green per PR.
- New PTY tests stay serial (`pool: 'forks'`) in the dedicated `*.ptytest.ts` project; if a scenario
  is CI-flaky, gate it behind `test:pty` (build-gated) and `log()` the decision — never silently skip.
- A coverage delta is reported per phase (which flags/commands moved from gap → covered in section C
  of the inventory).

## User Execution Test Scenarios

This is agent-facing test infrastructure work; its product value is regression protection for
agent-cli. Validated by the tests themselves running green in CI and locally. Per phase, the
"scenario" is the new automated test exercising the real CLI (built binary or `startCli`) and the
captured pass evidence recorded on the phase's PR. No separate manual scenario applies (the tests ARE
the executable scenarios). Evidence: _per-phase, filled as each PR lands._

## Notes

- Idea captured per [[feedback_capture_ideas_as_todo]]; this is the plan/umbrella — implementation
  proceeds phase by phase after the plan is approved.
- Keep determinism absolute: no live provider keys, no network — scripted/replay providers only.
- Respect the framework boundaries ([[feedback_no_shared_cli_factory]], API/orchestrator separation);
  shell/editor specifics belong to the consumer command modules, not the harness.
