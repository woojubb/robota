# Agent SDK Docs

`@robota-sdk/agent-framework` is the assembly layer for interactive sessions, command sources, context loading, prompt file references, context reference inventory, skills, memory, checkpoints, and subagent runtime wiring.

## Current Capabilities

- `InteractiveSession` owns session execution for CLI and transports.
- `startRuntimeHost()` builds and serves a headless session over a loopback WS (used by `robota --serve` and the desktop GUI sidecar); `buildRuntimeSession()` is the shared session-construction seam every presentation builds its `InteractiveSession` through (RUNTIME-001).
- Active `.agents/tasks` context can be injected into system prompt composition.
- Prompt `@file` references are parsed, resolved, diagnosed, and recorded by SDK-owned context APIs.
- Manual context references are managed by SDK-owned inventory APIs and consumed by command packages through command common APIs.
- Skills, system commands, memory, checkpointing, and rewind behavior are SDK-level capabilities.
- Session assembly includes local `WebSearch`/`WebFetch` tools separately from provider-native hosted web capabilities.
- Model-invocable built-in commands are exposed through SDK-projected `robota_command_*` tools.
- Session event hooks expose execution-boundary events used by session logs and future replay validation.

## Documents

- [Package README](../README.md) — usage examples and SDK entry points.
- [SPEC.md](./SPEC.md) — package contract, ownership boundaries, and public API surface.
- [PUBLIC-SURFACE.md](./PUBLIC-SURFACE.md) — SDK export ownership classes and mechanical guard.
