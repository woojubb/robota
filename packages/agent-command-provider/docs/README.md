# Agent Command Provider Docs

`@robota-sdk/agent-command-provider` owns the `/provider` command module for provider profile setup, switching, and testing.

## Current Capabilities

- Parses `/provider` command requests into provider profile operations.
- Runs provider setup through SDK command interactions and provider common APIs.
- Keeps provider command parsing and setup behavior outside SDK core and the CLI TUI layer.

## Documents

- [Package README](../README.md) — package overview.
- [SPEC.md](SPEC.md) — package contract, ownership, public API, and verification expectations.
