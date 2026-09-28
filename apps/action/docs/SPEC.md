# Action App Specification

## Purpose

`@robota-sdk/action` is the official Robota GitHub Actions runner: it turns Actions inputs into a
call to `@robota-sdk/agent-cli` and surfaces the agent's reply as an Actions output. It is the sole
integration point between GitHub CI/CD workflows and the Robota agent CLI.

## Contract

- All AI execution, authentication, provider selection, and output formatting are delegated to
  `@robota-sdk/agent-cli`; this app does not implement agent runtime, session, provider, or tool logic.
- The checkout is untrusted unless the workflow sets `load-project`. Nothing in it decides which
  program runs, and by default the CLI runs in safe mode, so a pull request's own settings, hooks and
  MCP servers never run on the runner.
- The `api-key` input is forwarded only as `ANTHROPIC_API_KEY` in the child process environment —
  it is not otherwise stored, logged, or transformed.
- A failed invocation fails the Actions step rather than silently succeeding, and says which step
  failed without repeating the task.

## Non-goals

- No library API or exported symbols for programmatic consumption — this app is an executable entry
  point only.
- No retry or fallback logic; failures propagate immediately.

## Design decisions

- It is a composite action that runs plain JavaScript with the Node.js it sets up: nothing has to be
  built or committed for a `uses:` reference to work, and the CLI gets a Node.js version it supports
  whatever the runner has cached.
- The CLI is installed with npm in the runner's temp directory and its entry script run with Node,
  not through `npx` in the checkout: npm reads the `.npmrc` of the directory it runs in, and a package
  runner prefers a copy of the package it finds there, so the checkout would choose the program. npm
  runs without the API key in its environment.
- Inputs reach the script only through the step's environment. The task reaches the CLI on stdin,
  never as an argument: as an argument, a task that is exactly a subcommand's name ran that
  subcommand in the checkout, and a long one could exceed the system's limit on one argument. The
  other inputs are literal argv elements with no shell.
- The agent's output is untrusted too: while the CLI runs and while its reply is logged, the runner
  reads no workflow commands, and the output value uses a random delimiter.
