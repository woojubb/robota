# Action App Specification

## Purpose

`@robota-sdk/action` is the official Robota GitHub Actions runner: it turns Actions inputs into a
call to `@robota-sdk/agent-cli` and surfaces the agent's reply as an Actions output. It is the sole
integration point between GitHub CI/CD workflows and the Robota agent CLI.

## Contract

- All AI execution, authentication, provider selection, and output formatting are delegated to
  `@robota-sdk/agent-cli`; this app does not implement agent runtime, session, provider, or tool logic.
- The checkout is untrusted unless the workflow sets `load-project`: by default the CLI runs in safe
  mode, so a pull request's own settings, hooks and MCP servers never run on the runner.
- The `api-key` input is forwarded only as `ANTHROPIC_API_KEY` in the child process environment —
  it is not otherwise stored, logged, or transformed.
- A failed invocation fails the Actions step rather than silently succeeding.

## Non-goals

- No library API or exported symbols for programmatic consumption — this app is an executable entry
  point only.
- No retry or fallback logic; failures propagate immediately.

## Design decisions

- It is a composite action that runs plain JavaScript with Node.js set up by the action itself: nothing
  has to be built or committed for a `uses:` reference to work, and the CLI gets the Node.js version it
  needs whatever the runner has.
- Inputs reach the script only through the step's environment, and the CLI only as argv with no shell,
  so workflow inputs cannot inject commands.
- The agent's reply is untrusted too: the log wraps it so the runner reads no workflow commands from it,
  and the output value uses a random delimiter.
