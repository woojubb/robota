# Audit Report: capability-placement.md

**File:** `.agents/specs/architecture-map/capability-placement.md`
**Audit date:** 2026-05-18

---

## Stale References

| Line | Current text                                            | Correct text                                               | Reason                                                                                                                                      |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 18   | `Web["agent-web"]`                                      | `Web["agent-web-ui"]`                                      | Package was renamed: `packages/agent-web` → `packages/agent-web-ui` (`@robota-sdk/agent-web-ui`). The mermaid node label uses the old name. |
| 53   | `` `agent-web` ``                                       | `` `agent-web-ui` ``                                       | Same rename. Owner Selection Table lists `agent-web` as a shell package; correct shortname is `agent-web-ui`.                               |
| 64   | `` `agent-web` owns routes and deployment host only. `` | `` `agent-web-ui` owns routes and deployment host only. `` | Same rename; applies to the "Product shell responsibility" column for the Playground row.                                                   |

---

## Missing References

The following packages exist in `packages/` but are not mentioned anywhere in this document. Whether they need entries depends on whether they carry user-visible capabilities:

- `agent-interface-transport` — no reference. Likely belongs in the Adapters layer (transport contracts/interfaces). If it defines transport-visible protocol contracts (see Stop Conditions), it should appear alongside `agent-transport`.
- `agent-interface-tui` — no reference. Likely belongs in the Adapters or Shell layer alongside `agent-cli`.
- `agent-team` — no reference. Multi-agent team orchestration is a product-visible capability; ownership should be stated (likely Services or Assembly layer).

---

## Summary

There are **3 stale `agent-web` references** (lines 18, 53, 64) that should all read `agent-web-ui` following the package rename.

Additionally, **3 packages** present in `packages/` are entirely absent from the Ownership Layer Map and Owner Selection Table: `agent-interface-transport`, `agent-interface-tui`, and `agent-team`. These omissions may leave placement ambiguous for future contributors, but they are not incorrect references — they are gaps rather than staleness.

No other package names in the file were found to be incorrect. All other package shortnames (`agent-cli`, `agent-command`, `agent-framework`, `agent-session`, `agent-executor`, `agent-subagent-runner`, `agent-provider`, `agent-transport`, `agent-tools`, `agent-tool-mcp`, `agent-plugin`, `agent-core`, `agent-playground`, `agent-remote-client`, `agent-server`, `apps/docs`, `apps/blog`) match current directory names and `package.json` names.
