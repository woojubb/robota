# Multi-Input Node Specification

## Scope

- Owns the `multi-input` DAG node definition.
- Acts as a multi-slot pipeline entry point that emits named output ports populated from runtime input values or static config defaults.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Has no input ports — it is always a source node in the DAG graph.
- Port names are declared via `config.ports`; values come from runtime input or `config.values` fallback.

## Architecture Overview

- `MultiInputNodeDefinition` — node with dynamic output ports declared at config time.
- Port resolution order: runtime input value → `config.values[key]` → empty string.
- If `config.ports` is empty, ports are inferred from the union of `config.values` keys and runtime input keys.
- Emits `_agentSummary` describing the number and names of emitted ports.
- Zero cost estimate (`estimatedCredits: 0`).

## Type Ownership

| Type                       | Location       | Purpose                   |
| -------------------------- | -------------- | ------------------------- |
| `MultiInputNodeDefinition` | `src/index.ts` | Node definition class     |
| `MultiInputConfigSchema`   | `src/index.ts` | Zod config schema (local) |

## Public API Surface

- `MultiInputNodeDefinition` — class (default export via package index)

## Extension Points

- Config `ports`: array of port key names to declare as outputs.
- Config `values`: record of static default values per port key, used when runtime input is absent.
