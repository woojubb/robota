# Audit Report: agent-cli/target-architecture.md

Audited file: `.agents/specs/architecture-map/agent-cli/target-architecture.md`
Source-verified date in file: 2026-05-17
Audit date: 2026-05-18

## Stale References

| Line | Current text | Correct text | Reason |
| ---- | ------------ | ------------ | ------ |
| —    | (none found) | —            | —      |

No stale package name references were found. All package names in prose, tables, and the Mermaid diagram use the current canonical names:

- `agent-cli`, `agent-framework`, `agent-session`, `agent-executor`, `agent-tools`, `agent-core`
- `agent-command`, `agent-provider`, `agent-subagent-runner`, `agent-transport`
- `agent-transport/tui` subpath (referenced inline at line 29 and in Mermaid node at line 86)

Old names (`agent-sdk`, `agent-sessions`, `agent-web`, `agent-transport-tui`, `agent-transport-headless`, `agent-command-*`, `agent-provider-*`, `agent-plugin-*`) are absent.

## Missing References

The following current packages are not mentioned in this file. This is expected for a CLI-scoped architecture document but noted for completeness:

- `agent-interface-transport` — interface contract package; not a CLI direct dependency
- `agent-interface-tui` — interface contract package; not a CLI direct dependency
- `agent-playground` — development/testing tool; not a CLI runtime dependency
- `agent-remote-client` — remote invocation client; out of scope for local CLI arch
- `agent-team` — multi-agent coordination; out of scope for single-CLI arch
- `agent-tool-mcp` — MCP-specific tool bridge; not surfaced in CLI arch layer
- `agent-web-ui` (renamed from `agent-web`) — web UI package; CLI is TUI-only, out of scope

None of these absences are errors in the document.

## Summary

The file is **clean**. All package names are up to date with the current package inventory. No corrections are required. The document correctly uses:

- `agent-framework` (not the old `agent-sdk`)
- `agent-session` (not the old `agent-sessions`)
- `agent-transport` with `/tui` subpath notation (not the old `agent-transport-tui`)
- `agent-command` (consolidated form, no old `agent-command-*` suffixes)
- `agent-provider` (consolidated form, no old `agent-provider-*` suffixes)

The Mermaid flowchart at lines 76–112 and the edge-rule table at lines 114–127 are both consistent with the prose and with current package names.
