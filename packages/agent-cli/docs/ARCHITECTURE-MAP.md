# Agent CLI Architecture Map

This package-local file is now a stable router. The detailed LLM-scannable CLI architecture map is
routed through the repository architecture-map tree:

- [../../../.agents/specs/architecture-map/agent-cli-composition.md](../../../.agents/specs/architecture-map/agent-cli-composition.md)

Use that document before changing any of these areas; it routes to focused files for target
architecture, composition, commands/provider flow, execution modes, inventory, and layer audits:

- `packages/agent-cli/src/cli.ts` provider, command module, transport, or runtime adapter composition;
- TUI hooks such as `useInteractiveSession`, `useSlashRouting`, or `useSideEffects`;
- built-in command composition, command effects, command interactions, or plugin command discovery;
- provider setup, provider switching, model catalog, or model switching flow;
- interactive TUI vs non-interactive print-mode behavior;
- package dependencies among CLI, SDK, command packages, providers, runtime, sessions, tools, or core.

Package contract truth remains in [SPEC.md](SPEC.md). This router preserves the package docs
entrypoint while keeping detailed architecture grouped under the repository architecture-map folder.
