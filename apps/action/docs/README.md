# Action App — Documentation

Official Robota GitHub Action (`@robota-sdk/action`, internal — not published to npm). A workflow step
passes a `task` prompt; the action runs `@robota-sdk/agent-cli` on it and returns the agent's reply as
the `result` output. Inputs and outputs are declared in [`action.yml`](../action.yml).

## Documents

| Document             | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| [SPEC.md](./SPEC.md) | Contract: delegation to the CLI, API-key handling, failure behavior, design choices |
