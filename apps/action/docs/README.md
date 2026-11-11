# Action App — Documentation

GitHub Action (`@robota-sdk/action`, internal — not published to npm). A workflow step
names the product (`package-scope` and `cli-name`) and passes a `task` prompt; the action installs
`<package-scope>/agent-cli` (`cli-version`: an exact version or a dist-tag, default `latest`), runs the
command that package's `bin` declares for `cli-name` on the task, and returns the agent's reply as the
`result` output. For Robota the scope is `@robota-sdk` and the command is `robota`. Inputs and outputs
are declared in [`action.yml`](../action.yml); the composite action runs
[`src/main.mjs`](../src/main.mjs) directly, with no build step.

## Documents

| Document             | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Contract: delegation to the CLI, API-key handling, failure behavior, design choices |
