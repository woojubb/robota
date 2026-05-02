# Agent CLI Docs

`@robota-sdk/agent-cli` is the terminal UI for Robota. It renders `InteractiveSession` state from `@robota-sdk/agent-sdk` and keeps session logic in the SDK.

## Current Capabilities

- Interactive TUI and print/headless mode through the `robota` command.
- Provider-definition setup UI for Anthropic, OpenAI-compatible, Gemma, and Qwen profiles.
- npm update checks with deterministic print/headless behavior.
- Status activity, provider usage summaries, background work tree rows, and collapsed command-output transcripts.
- Edit diffs rendered as context hunks with markdown-friendly blocks.
- Runtime-backed background subagents with transcripts and resumable task snapshots.

## Documents

- [Package README](../README.md) — installation, flags, permissions, TUI usage.
- [SPEC.md](./SPEC.md) — package contract, ownership boundaries, and public behavior.
