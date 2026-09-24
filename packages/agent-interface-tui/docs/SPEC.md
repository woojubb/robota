# agent-interface-tui Specification

## Scope

Owns TUI interaction contracts for the Robota SDK. This package contains only type contracts —
no implementation, no classes, no runtime functions, no React, no Ink.

It defines the interaction protocol between command handlers (which may run at any layer) and TUI
renderers (which live in `agent-ui-terminal`).

## Boundaries

- **Contains only type contracts — no runtime functions, no implementation, no UI, no React.**
- Depends on nothing (`@robota-sdk/agent-core` is not required; TUI contracts are UI-layer only).
- Implementation rendering lives in the `agent-ui-terminal` package.
- `agent-ui-terminal` uses these contracts to describe TUI interaction requirements for command modules.

This package exports no runtime functions. The interaction union is a discriminated union — narrow
it directly on its action-kind literal; no dedicated type-guard functions are provided.

## Invariants

- This package must never gain runtime dependencies.
- No framework or provider knowledge may enter this package.
- The interaction vocabulary includes a `wizard` action kind that a transport may leave unimplemented.
