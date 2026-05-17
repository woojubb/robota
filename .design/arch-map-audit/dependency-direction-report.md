# Audit Report: dependency-direction.md

File audited: `.agents/specs/architecture-map/dependency-direction.md`

---

## Stale References

| Line         | Current text                       | Correct text                          | Reason                                                                                                                                                                                                                                                                                                                                         |
| ------------ | ---------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 (diagram) | `agent-cli, agent-web, docs, blog` | `agent-cli, agent-web-ui, docs, blog` | The package `agent-web` was renamed to `agent-web-ui` (`@robota-sdk/agent-web-ui`). The ProductShells node in the Mermaid diagram mixes app names (docs, blog) with package names; `agent-web` as a package is now `agent-web-ui`. `apps/agent-web` still exists as the app directory, but the canonical package/scope name is `agent-web-ui`. |
| 71 (prose)   | `` `agent-web`, docs, blog ``      | `` `agent-web-ui`, docs, blog ``      | Same rename. The backtick usage indicates a package/scope reference; the renamed package is `agent-web-ui`.                                                                                                                                                                                                                                    |

---

## Missing References

The following packages exist in the monorepo but are not mentioned anywhere in this file:

- **`agent-interface-transport`** — present in `packages/agent-interface-transport`; its layer/owner is unspecified. Likely belongs in the Transport shells or Domain contracts layer.
- **`agent-interface-tui`** — present in `packages/agent-interface-tui`; its layer/owner is unspecified. Likely belongs in the Transport shells layer alongside `agent-transport/tui`.
- **`agent-playground`** — present in `packages/agent-playground`; its layer/owner is unspecified. May be a product shell or a standalone utility.

---

## No Issues Found

The following known renames were already applied correctly in this file:

- `agent-sdk` → `agent-framework`: correctly used throughout (lines 12, 49, 70).
- `agent-sessions` → `agent-session`: correctly used (`Sessions["Session services\nagent-session"]`, line 15).
- `agent-transport/tui`, `agent-transport/ws`, `agent-transport/http`, `agent-transport/headless`, `agent-transport/mcp`: all correctly use subpath notation (line 13).
- `agent-provider`, `agent-plugin`, `agent-command`: consolidated names used correctly throughout.

---

## Summary

Two stale references to the old package name `agent-web` were found — one inside the Mermaid diagram node (line 11) and one in the prose section (line 71). Both should be updated to `agent-web-ui` to match the renamed package `@robota-sdk/agent-web-ui`.

Three packages (`agent-interface-transport`, `agent-interface-tui`, `agent-playground`) are entirely absent from the dependency direction map and have no assigned layer. These are missing references that should be addressed when the architecture map is next updated.

All other known renames (agent-sdk, agent-sessions, transport subpaths, consolidated command/provider/plugin packages) are already correctly reflected in this file.
