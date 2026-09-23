# ADR-006: Remove the superseded DAG MCP surfaces

## Status

accepted

## Context

The owner selected removal of the three DAG-specific MCP surfaces in issue #2817 on
2026-09-22. The workflow product is the agent CLI `/workflows` command, whose default node
catalog does not include the external-MCP node. The internal `dag-cli` shell also retains
useful non-MCP workflow commands.

## Alternatives Considered

1. Keep both DAG MCP servers and migrate the MCP node to the shared client, as ADR-005
   originally proposed. This preserves an additional integration form but maintains surfaces
   outside the selected workflow product boundary.
2. Remove the entire internal CLI as well. This removes additional code but also discards
   non-MCP execution and inspection commands outside the approved removal scope.
3. Remove only the DAG MCP surfaces and their exclusive supporting code. This implements
   the owner decision while preserving the command product and internal non-MCP CLI.

## Decision

Choose alternative 3. Remove `dag-mcp-server`, `dag-cli`'s MCP server command and handlers,
and the `dag-node-mcp-tool` package. Retain the remaining CLI and the identical default
`/workflows` node catalog.

This supersedes only ADR-005's DAG-node migration, DAG-local stdio replacement, and
`dag-node-mcp-tool → agent-mcp` dependency obligations. MCP-002 retains its agent client
work; MCP-2522 retains its admitted shared stdio adapter and subprocess-security scope
for the agent product. Neither must restore DAG stdio execution.

## Consequences

The DAG product has no MCP server or external-MCP workflow node. Removed entry points
are not retained as compatibility facades. Package manifests, dependency records, test
selection, architecture maps, and pending changesets no longer target the removed packages.
Historical Task/spec and changelog evidence remains readable without rewriting history.

## References

- [Issue #2817](https://github.com/woojubb/robota/issues/2817)
- [ADR-005](ADR-005-shared-mcp-owner-and-migration-boundary.md)
- [DAG architecture map](../../.agents/specs/architecture-map/dag-system.md)
