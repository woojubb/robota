# agent-plugin-error-handling Specification

## Scope

Error handling plugin for Robota SDK. This is a private package (not published to npm).

## Boundaries

- Internal package — not part of the public API surface.
- See `@robota-sdk/agent-core` for the interfaces this package implements.
- Implements `AbstractPlugin` from `@robota-sdk/agent-core`. This package depends only on
  `agent-core` and must not import `agent-sdk`, `agent-sessions`, `agent-cli`, or any other
  agent-\* package.
- Injected by the consuming layer (agent-cli or composition root) at construction time.
  This package does not own a registry or factory; the consumer selects and wires plugins.

## Architecture Overview

See package source for implementation details.

## Dependencies

See `package.json` for the dependency list.
