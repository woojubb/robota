# agent-tool-mcp Specification

## Scope

MCP protocol tool implementations for Robota SDK. This is a private package (not published to npm).

## Boundaries

- Internal package — not part of the public API surface.
- See `@robota-sdk/agent-core` for the interfaces this package implements.
- Implements the tool contract defined in `@robota-sdk/agent-tools` using the MCP (Model Context
  Protocol) transport. Allowed dependencies: `@robota-sdk/agent-core`, `@robota-sdk/agent-tools`,
  and `@modelcontextprotocol/sdk`. Must not import `agent-sdk`, `agent-sessions`, `agent-cli`, or
  any other agent-\* package.
- Injected by the consuming layer (agent-cli or composition root) at construction time.
  This package does not own a registry or factory; the consumer selects and wires tools.

## Architecture Overview

See package source for implementation details.

## Dependencies

See `package.json` for the dependency list.
