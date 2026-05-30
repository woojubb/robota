# Audit Report: agent-cli/commands-and-provider-flow.md

Source file: `.agents/specs/architecture-map/agent-cli/commands-and-provider-flow.md`
Audited: 2026-05-18

---

## Stale References

| Line | Current text                                                       | Correct text                                                                   | Reason                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 55   | `participant SDKCommon as SDK provider common APIs`                | `participant SDKCommon as agent-framework provider common APIs`                | Participant label uses the old "SDK" shorthand instead of the renamed package `agent-framework`. The same alias `SDKCommon` is used in the first flowchart (line 14) where it is already labeled `agent-framework common APIs` — the sequence diagram must match. |
| 83   | `SDK model command common APIs orchestrate TTL-based auto-refresh` | `agent-framework model command common APIs orchestrate TTL-based auto-refresh` | Prose uses bare "SDK" to mean `agent-framework`. Should use the concrete package name for consistency.                                                                                                                                                            |

---

## Missing References

- The sequence diagram (lines 49–74) references `provider-setup.ts` and `provider-factory.ts` as free-floating participants with no package attribution. Their owning package (`agent-cli`) is not stated in the diagram. A note or label such as `participant Setup as agent-cli/provider-setup.ts` would eliminate ambiguity.
- `agent-provider` (the consolidated provider package, formerly `agent-provider-*`) is only referred to generically as "provider packages" (lines 81, 83). One explicit mention of `@robota-sdk/agent-provider` in the Settings ownership section would anchor the consolidated package name.

---

## Summary

The file is largely up-to-date. It already uses the correct renamed packages:

- `agent-framework` (renamed from `agent-sdk`) — correct in flowchart node labels and responsibility table
- `agent-command` (consolidated from `agent-command-*`) — correct throughout
- `agent-cli`, `agent-session`, `agent-provider` — all referenced correctly where named

Two stale references remain, both using the old bare "SDK" abbreviation in place of `agent-framework`:

1. **Line 55** — sequence diagram participant label (`SDK provider common APIs` → `agent-framework provider common APIs`)
2. **Line 83** — prose (`SDK model command common APIs` → `agent-framework model command common APIs`)

These are low-severity label inconsistencies; the underlying architecture description is accurate. No references to the removed/renamed packages (`agent-sdk`, `agent-sessions`, `agent-command-provider`, `agent-provider-openai`, etc.) were found.
