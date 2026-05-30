# Audit Report: repository-overview.md

**File audited:** `.agents/specs/architecture-map/repository-overview.md`
**Date:** 2026-05-18

---

## Stale References

| Line | Current text                  | Correct text   | Reason                                                                                                                                                                                 |
| ---- | ----------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 59   | `agent-web` (browser monitor) | `agent-web-ui` | Package was renamed from `agent-web` to `agent-web-ui` (`@robota-sdk/agent-web-ui` confirmed). The label "(browser monitor)" should be verified against the package's current purpose. |

## Missing References

The following packages exist under `packages/` but are not listed anywhere in the table or diagram:

- `agent-interface-transport` (`@robota-sdk/agent-interface-transport`) — present in `packages/` but absent from the "Agent runtime and CLI" family row and from the Mermaid diagram.
- `agent-interface-tui` (`@robota-sdk/agent-interface-tui`) — present in `packages/` but absent from the "Agent runtime and CLI" family row and from the Mermaid diagram.

## Diagram Notes

The Mermaid diagram (lines 13–55) is largely consistent with current package names. Specific observations:

- `agentWeb["apps/agent-web"]` (line 38, Playground subgraph): The _app_ `apps/agent-web` still exists on disk, so this node label is correct for the app. However it may cause confusion because the _package_ of the same family was renamed to `agent-web-ui`. Consider clarifying the label, e.g. `agentWeb["apps/agent-web (playground app)"]`.
- `agent-interface-transport` and `agent-interface-tui` nodes are absent from the diagram. These are distinct packages from `agent-transport` and should appear if they are architecture-relevant.

## Table Notes

- Line 59, "Agent runtime and CLI" row: replace `agent-web` with `agent-web-ui` and add `agent-interface-transport`, `agent-interface-tui` if they belong to this family.
- Line 62, "Agent playground" row: `apps/agent-web` as an app name is still accurate, but might warrant a note distinguishing it from the `agent-web-ui` package.

## Summary

One confirmed stale package name was found:

- **`agent-web`** (table, line 59) must be updated to **`agent-web-ui`** to match the current `@robota-sdk/agent-web-ui` package.

Two packages present on disk are entirely absent from both the diagram and the table:

- **`agent-interface-transport`**
- **`agent-interface-tui`**

These omissions may be intentional (e.g., if they are considered internal sub-packages of `agent-transport`), but should be explicitly confirmed or documented. All other package names in the diagram and table match the current `packages/` directory.
