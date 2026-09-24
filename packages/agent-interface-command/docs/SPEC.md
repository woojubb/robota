# SPEC.md — @robota-sdk/agent-interface-command

## Purpose

This package owns the **command contract family**: what a command is, what it returns, how it is
listed and invoked, the plugin surfaces a command host exposes, and the capability descriptors a
command declares about itself. It contains type declarations only — no class, no runtime logic,
no mechanism, and no runtime value except a small set of discriminators.

**This package declares what a command IS; it decides nothing about what any command DOES.**

## Boundaries

| Concern                                                | Owner                                  |
| ------------------------------------------------------ | -------------------------------------- |
| Command implementations and their modules              | `agent-command`, command-module owners |
| Command infrastructure and reusable host APIs          | `agent-framework`                      |
| Rendering a command's result                           | `agent-ui-terminal`, `agent-ui-web`    |
| Session, interaction, event, turn and driver contracts | `agent-interface-session`              |
| Background task, workspace and subagent contracts      | `agent-interface-execution`            |

## Design decisions

- **Layer 0.** It depends on no peer `agent-interface-*` package; composition runs downward into
  it (e.g. `agent-interface-session` names these types, never the reverse). That direction is a
  boundary this package commits to beyond what the manifest alone enforces.
- `capability-contracts` has no consumer outside this package but is deliberately kept public.
- The command/session boundary test (asserting a command action and a session event remain
  distinct) lives in `agent-interface-session`, not here, because it necessarily names types from
  both sides — putting it here would create an upward dependency from this Layer 0 package.

## Non-goals

- No extension points by design — a contract package is extended by amending a declaration, not by
  a plugin mechanism of its own.
- Declares no error type and throws nothing; a failed command is reported through
  `ICommandResult.success` as a result shape, and what follows a failure is the host's decision.
