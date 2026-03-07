# Agents Specification

## Scope
- Owns the core Robota agent runtime, tool integration, conversation execution, and plugin-facing agent behavior.
- Defines the canonical agent orchestration surface used by provider and higher-level packages.

## Boundaries
- Keeps provider-specific transport behavior in provider packages.
- Keeps package-specific domain contracts owned once and reused through public surfaces.
