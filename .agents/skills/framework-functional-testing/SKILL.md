---
name: framework-functional-testing
description: Functionally verify a Robota feature at the framework level by driving a real InteractiveSession through the deterministic scripted provider — no CLI, no live LLM. Use whenever you add or change a capability the CLI exposes, instead of testing at the CLI surface or skipping E2E.
---

# Framework Functional Testing (the agent's standard feature E2E)

## Rule Anchor

- [.agents/rules/testing-layering.md](../../rules/testing-layering.md) — CLI = thin-wrapper/TUI tests
  only; feature behaviour MUST have a framework-level functional test.
- `AGENTS.md` > "Build Requirements", "No Fallback".

## Use This Skill When

- You added or changed a capability on `InteractiveSession` (or a command/flag that drives one).
- You are tempted to write the feature's E2E "through the CLI", or to skip E2E because "the CLI is
  hard to test" or "it needs a live model". Both are rejected — use this instead.
- A backlog's Test Plan / User Execution gate needs a real, automatable functional proof.

## Why

The CLI is a thin wrapper with no feature logic; every capability is **framework + feature**. The
product surface that must be tested is `InteractiveSession`. The scripted harness drives the **real**
loop deterministically, so functional verification is automatable and mandatory — not optional.

## The harness

`@robota-sdk/agent-framework/testing`:

- `scriptedSession({ turns, files?, persistence?, commandModules?, permissionMode?, bare?, maxTurns? })`
  → a `ScriptedSessionHarness` wrapping a **real** `InteractiveSession` in an isolated temp workspace,
  driven by `createScriptedProvider` (SSOT in `@robota-sdk/agent-core/testing`).
- **Drivers:** `await h.submit(prompt)` → the completed turn; `await h.runGoal(objective, opts)` →
  the stopped goal; `await h.awaitEvent(name, predicate?)`.
- **Inspectors:** `h.history()`, `h.sessionRecord()` (needs `persistence: true`), `h.toolCalls()`,
  `h.emittedEvents(name)`, `h.readFile(rel)` / `h.exists(rel)` / `h.files()`, `h.requests`.
- **Lifecycle:** always `await h.dispose()` in `afterEach`.
- `turns` are scripted assistant turns: `{ text }` or `{ toolCalls: [{ name, args }] }`. Use the
  `{{cwd}}` placeholder inside tool args to reference absolute workspace paths (e.g.
  `{ filePath: '{{cwd}}/out.txt' }`), since the workspace path is unknown until the harness is built.

## Workflow

1. Script the assistant turns that exercise the capability (tool calls + the final text/signal).
2. Build the harness with the needed options (seed `files`, `persistence`, `commandModules`).
3. Drive it (`submit` / `runGoal`) and assert on real effects: workspace files, history, tool calls,
   emitted events, the persisted session record, recorded provider requests.
4. `dispose()` in teardown.
5. Register the capability in the functional-coverage manifest (see the manifest the
   `functional-coverage` harness scan checks) so coverage is mechanically enforced.

## Reference example

`packages/agent-framework/src/testing/__tests__/scripted-session-harness.test.ts` (harness self-test)
and the GOAL-001 functional test drive multi-turn flows with real tool calls and assert real file
and event effects — copy their shape.

## Anti-patterns

- Proving feature behaviour only through `startCli` / CLI args. (CLI tests = wrapper/TUI only.)
- Using `createTestInteractiveSession()` (a stub) to "test" behaviour — it does not run the loop;
  it is for wiring/type checks only.
- Skipping the functional test because a live model "would be needed". The scripted provider replaces
  the model deterministically.
