---
title: 'GOAL-001: Autonomous objective-pursuit loop (persistent goal) for agent-framework + agent-cli'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-command, packages/agent-cli
depends_on: []
---

# Autonomous objective-pursuit loop (persistent goal)

A universal agent capability: the user sets a **high-level objective ("goal")** and the agent then
works toward it **autonomously across multiple turns** — re-engaging itself after each turn,
checking whether the objective is satisfied, and continuing until it is (or a stop condition is
hit). This is a generic agent-runtime concept; it must be named and modelled in vendor-neutral
terms (no competitor/product names anywhere in code, types, prompts, or docs — see the
no-product-names rule).

This backlog is **research-grounded but design-gated**: the architecture map below is confirmed
against the current code, but the core contract decisions (how satisfaction is judged, the exact
surface, stop conditions) require explicit design confirmation **before any implementation starts**.

## What

Add a first-class "goal" capability:

1. **Set a goal** — the user declares a persistent objective (interactive slash command for TUI;
   a flag for headless/scriptable runs).
2. **Pursue it autonomously** — after each turn completes, the runtime decides whether the goal is
   met; if not, it re-engages the agent with a continuation prompt and keeps going.
3. **Stop deterministically** — the loop ends when the goal is judged satisfied, a bound is reached
   (max iterations / token budget), the user interrupts, or no progress is detected (convergence).
4. **Observe & control** — goal state and per-iteration progress are visible and the user can
   inspect / cancel the goal at any time.

## Why

Today the agent is strictly turn-by-turn: a single `submit()` runs to completion and then waits for
the next user input. There is no built-in way to hand the agent a standing objective and have it
drive itself to completion. This is one of the most common high-leverage agent patterns (long-task
automation, "keep going until done", batch/sweep work) and every comparable tool ships some form of
it. Building it as a clean, vendor-neutral framework capability (not a CLI hack) makes it reusable
across every transport (TUI, headless, future server) and keeps the satisfaction/stop logic owned by
the SDK layer rather than duplicated per surface.

## Research findings (confirmed against current code)

Verified by reading `agent-framework`, `agent-executor`, `agent-session`, `agent-core`,
`agent-command`, and `agent-cli`.

**Turn loop & completion**

- A turn runs through `InteractiveSession.submit()`
  (`packages/agent-framework/src/interactive/interactive-session.ts`) →
  `SessionExecutionController.executePrompt()`
  (`.../interactive-session-execution-controller.ts`) → `executePromptTurn()` →
  `session.run()`. It emits `complete` / `interrupted` / `error` on the interactive-session event
  channel; `complete` carries an `IExecutionResult` (response, usage, tools used).
- The `Stop` hook (`packages/agent-core/src/hooks/types.ts`) is **fire-and-forget** (the firing
  site `.catch()`es and continues) — it **cannot** block a turn or request a continuation. So the
  goal loop must drive continuation explicitly, not via the Stop hook.

**Proven re-engagement primitive (reuse, don't reinvent)**

- `InteractiveSession.requestWakeup(instruction, sourceTaskId)` already re-enters the agent loop by
  calling `submit(instruction, …, { turnSource: 'agent-wakeup', wakeTaskId })`, and **coalesces**
  duplicate wakes by `sourceTaskId`. This is what `/schedule`, `/monitor`, and background-task
  completion already use to wake the agent. The `turn_source` event (`'user' | 'agent-wakeup'`)
  lets us distinguish goal-driven turns from user turns. **This is the primary building block for
  the goal loop.**

**No existing goal feature**

- `/background`, `/schedule`, `/monitor`, `--max-turns`, and `--continue/--resume` exist, but none
  takes an objective, evaluates satisfaction, and loops until done. No duplication risk; the goal
  loop is a higher-level policy that _uses_ the wakeup primitive.

**CLI surface & layering**

- Slash commands live in `@robota-sdk/agent-command` (pattern: `*-command-module.ts` +
  `*-command.ts`, registered via `createDefaultCommandModules()`); flags are parsed in
  `packages/agent-cli/src/utils/cli-args.ts` (`PARSE_ARGS_CONFIG`).
- Layering (`.agents/project-structure.md`, `agent-cli/docs/SPEC.md`): **goal state + satisfaction/
  stop logic must live in `agent-framework`** (SDK-owned); the `/goal` command lives in
  `agent-command`; `agent-cli` only wires the flag and must not reach below the framework.

## Design decisions (confirmed 2026-06-27)

User-confirmed answers to the core contract/product questions:

1. **Satisfaction judgment → structured completion signal.** The agent emits an explicit,
   schema-validated signal each round (`status: 'satisfied' | 'continue'` + a `reason`); the loop
   decision is deterministic and testable. No fragile string-matching / heuristic parsing.
2. **Surface → both.** A `/goal <objective>` slash command for the TUI **and** a headless flag for
   scriptable autonomous runs; both delegate to the framework-owned goal controller.
3. **Autonomy / stop → headless fully autonomous; TUI auto-continues, user can cancel anytime.**
   Headless runs unattended until satisfied or a bound fires. The TUI takes autonomous follow-up
   turns (tagged `agent-wakeup`, not user turns) and the user can cancel an in-flight goal at any
   time. Mandatory bounds on **every** path: max iterations, token/budget cap, user-interrupt, and a
   no-progress/convergence guard.
4. **Persistence → persisted in the session record.** An in-progress goal (objective + iteration
   progress) is stored in the session record and restored on `--resume`, so long-running goals
   survive a session restart.
5. **Naming → vendor-neutral "goal".** "goal" is a generic English term (not a vendor mark);
   public command/flag/type names stay generic with no product references.

**Process gate:** the concrete design note (contract type shapes, the goal-controller state machine,
exact command/flag names, and the SPEC.md change plan) is presented for a final review before any
implementation code is written, per the spec-before-code and design-confirmation rules. The package
SPEC.md (agent-framework, and agent-command for the new command) is the SSOT and is updated first.

## Approach (per confirmed decisions)

- Model goal state + the satisfaction/stop policy as an `agent-framework` concern attached to
  `InteractiveSession` (owner of `submit`/`requestWakeup`/events), driving continuation through the
  existing wakeup primitive tagged with a goal-scoped `wakeTaskId`.
- Satisfaction via a **structured completion signal** (deterministic, testable).
- Expose via **both** a `/goal` slash command (agent-command) and a headless flag (agent-cli),
  both delegating to the framework-owned goal controller.
- Persist goal state in the session record (survives `--resume`).
- Hard bounds (max iterations + budget + interrupt + no-progress) are mandatory on every path.

## Done When

- A user can set a goal and the agent autonomously pursues it across turns until satisfied or a
  stop condition fires, on at least one product surface (TUI and/or headless).
- Satisfaction and every stop condition are deterministic and covered by tests (no fragile string
  heuristics as the sole judge).
- Goal state and per-iteration progress are observable; the user can cancel an in-flight goal.
- No vendor/product names appear in any new code, type, prompt, or doc.
- agent-framework SPEC.md (and agent-command SPEC.md if a command is added) updated as SSOT; the
  three doc layers (SPEC/README/content) synced where user-facing.
- typecheck + lint + tests + `pnpm harness:scan` all green.

## Test Plan

- **Unit (agent-framework):** goal controller state machine — satisfied → stop; unsatisfied →
  continuation; max-iterations stop; budget stop; no-progress/convergence stop; user-interrupt
  stop. Drive with a fake session emitting scripted `complete`/structured-signal results (no live
  provider).
- **Unit (agent-command):** `/goal` command parses the objective, sets goal state on the session,
  and reports status; error path for empty objective.
- **Integration (headless):** a scripted/fake-provider run where the agent reaches "satisfied"
  after N iterations and the loop stops with the expected exit; and a run that hits the iteration
  bound.
- **Harness/CI:** `pnpm harness:scan` (conformance, no-product-names, file-size, deps), typecheck,
  lint, full `pnpm test`.

## User Execution Test Scenarios

_Exact surface (slash vs flag) is fixed during design confirmation; the scenario is finalized then.
Provisional, to be confirmed:_

1. **Headless autonomous run** — Prereq: a configured provider (existing `robota` setup). Run the
   Robota CLI in headless mode with a small, bounded goal (e.g. "create a file `GOAL.txt` containing
   the current date, then stop") using the goal surface. Expected observable result: the CLI runs
   multiple autonomous iterations without further user input, produces `GOAL.txt`, reports the goal
   as satisfied, and exits 0; running again with an impossible/over-bounded goal stops cleanly at
   the iteration bound with a clear "stopped: bound reached" message. Cleanup: delete `GOAL.txt`.
   **Evidence (executed):** run through the REAL `robota` print-mode binary path
   (`startCli` → arg parse → headless channel → `setGoal` → agent loop → builtin tools → output),
   driven by a deterministic scripted provider standing in for the live LLM — the repo's established
   product-surface E2E pattern (`packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts`,
   alongside the CLI-074 scenarios). Two scenarios pass:
   - `--goal "create GOAL.txt containing the date, then stop"` → the loop runs two autonomous turns
     (Write then a `satisfied` signal), `GOAL.txt` is written with the expected content, stdout
     contains `Goal satisfied`, and the process **exits 0**.
   - `--goal "an unbounded objective" --goal-max-iterations 2` (agent always signals `continue`) →
     the loop **exits 2** with stderr `Goal stopped: max-iterations (after 2 iteration(s)).`
     Captured `pnpm --filter @robota-sdk/agent-cli exec vitest run …/scripted-e2e.test.ts -t GOAL` →
     `2 passed`. The live-LLM run is the identical code path; its only added prerequisite is a
     configured provider/API key (`robota --configure`), which the user already has.
2. **TUI interactive goal** — `/goal <objective>` (and `/goal status` / `/goal cancel`) drive the
   same framework controller; the agent takes autonomous `agent-wakeup` turns until satisfied and the
   user can cancel at any time. Covered by `agent-command` `executeGoalCommand` tests and the
   `InteractiveSession` goal-wiring tests (the loop advances only on agent-driven turns and emits
   `goal_event`). A live TUI capture is the same controller exercised above through the headless
   surface.

## Evidence Log (completed 2026-06-27)

Implemented in three phases (one commit each), all per the confirmed design:

- **Phase 1 — framework core.** `agent-interface-transport`: `IGoalState`/`IGoalEvent` contract
  types, persisted in `IInteractiveSessionRecord.goal`; `goal_event` on the session channel; goal
  methods on `IInteractiveSession`. `agent-framework` `goal/`: pure `GoalController` state machine,
  the deterministic `report_goal_status` completion-signal tool (`createZodFunctionTool`, included
  in every interactive session), prompt builders. `InteractiveSession.setGoal`/`getGoalState`/
  `cancelGoal` driving continuation via the FLOW-002 `requestWakeup` primitive; goal persisted +
  restored on resume. 14 controller unit tests + 3 wiring tests; full framework suite 994 pass.
- **Phase 2 — `/goal` command.** `agent-command` `goal/` module (`/goal <objective>` | `status` |
  `cancel`) delegating to the framework via optional `ICommandHostContext` goal methods. 7 command
  tests; agent-command suite 193 pass.
- **Phase 3 — `--goal` headless.** `agent-transport` `HeadlessInteractionChannel.runGoal` + headless
  goal runner (exit 0 satisfied / 2 bound / 1 error); `agent-cli` `--goal` / `--goal-max-iterations`
  flags (`--goal` implies headless). 3 runner tests + 2 real-stack scripted E2E tests.

**Verification:** all five touched packages typecheck + lint (0 errors) + tests green; `pnpm
harness:scan` 32/32. Docs synced across the three layers (agent-framework + agent-command + agent-cli
SPEC.md, agent-cli README, `content/guide/cli.md`). No vendor/product names in any new code, type,
prompt, or doc.
