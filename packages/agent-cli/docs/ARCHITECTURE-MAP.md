# Agent CLI Architecture Map

This package-local file routes readers to the [CLI package contract](SPEC.md) and the source that
implements it. Consult those owners before changing these areas:

- `packages/agent-cli/src/cli.ts` provider, command module, transport, or runtime adapter composition;
- TUI hooks such as `useInteractiveSession`, `useTuiChannel`, or `useSideEffects`;
- built-in command composition, command effects, command interactions, or plugin command discovery;
- provider setup, provider switching, model catalog, or model switching flow;
- interactive TUI vs non-interactive print-mode behavior;
- package dependencies among CLI, SDK, command packages, providers, runtime, sessions, tools, or core.

Non-UI behavior exposed through the CLI must be owned below the CLI first. `agent-cli` may add TUI,
input handling, ephemeral selection state, product composition, and concrete local host adapters; it
must not own reusable behavior, lifecycle, retention, command semantics, background task spawning,
provider semantics, persistence, permission policy, or transport-visible contracts.

The package contract remains in [SPEC.md](SPEC.md); this file is only a navigation aid.
