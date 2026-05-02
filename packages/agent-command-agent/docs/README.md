# Agent Command Agent Docs

`@robota-sdk/agent-command-agent` owns the `/agent` command module for background subagent control.

## Current Capabilities

- Parses `/agent` command requests into SDK/runtime subagent operations.
- Supports explicit multi-agent and parallel-agent command paths.
- Keeps command parsing and command module behavior outside the CLI TUI layer.

## Documents

- [Package README](../README.md) — package overview.
- [SPEC.md](SPEC.md) — package contract, ownership, public API, and verification expectations.
