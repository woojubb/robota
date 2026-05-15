# agent-plugin-usage Specification

## Status

**Consumer opt-in — not built into the CLI or SDK by default (as of 2026-05-15).**

This plugin is not imported by any `agent-cli` or `agent-sdk` production assembly path. Application
consumers register this plugin at composition time by passing an instance to the SDK assembly API.

## Scope

Usage tracking plugin for Robota SDK. This is a private package (not published to npm).

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
