# Action App Specification

## Purpose

`@robota-sdk/action` is the official Robota GitHub Actions runner: it turns Actions inputs into a
call to `@robota-sdk/agent-cli` and surfaces the agent's reply as an Actions output. It is the sole
integration point between GitHub CI/CD workflows and the Robota agent CLI.

## Contract

- All AI execution, authentication, provider selection, and output formatting are delegated to
  `@robota-sdk/agent-cli`; this app does not implement agent runtime, session, provider, or tool logic.
- The `api-key` input is forwarded only as `ANTHROPIC_API_KEY` in the child process environment —
  it is not otherwise stored, logged, or transformed.
- A failed invocation fails the Actions step (`core.setFailed`) rather than silently succeeding.

## Non-goals

- No library API or exported symbols for programmatic consumption — this app is an executable entry
  point only.
- No retry or fallback logic; failures propagate immediately.

## Design decisions

- Execution is synchronous (`execSync`) so the runner waits for agent completion before proceeding.
