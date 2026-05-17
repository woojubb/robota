# Audit Report: agent-cli/class-interface-inventory.md

Source file: `.agents/specs/architecture-map/agent-cli/class-interface-inventory.md`  
Audited: 2026-05-18

---

## Stale References

| Line                                   | Current text                                                                                     | Correct text                                                                                                                                | Reason                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8–19 (package name map)                | Map lists `agent-transport-tui`, `agent-transport-headless`, `agent-transport-ws` as stale names | Also missing: `agent-transport-http` → `agent-transport` (subpath: `/http`) and `agent-transport-mcp` → `agent-transport` (subpath: `/mcp`) | The `/http` and `/mcp` subpaths are part of the consolidated `agent-transport` package (per the known renames) but are absent from the old→current name map                               |
| 8–19 (package name map)                | Map omits `agent-provider-*` (plural) → `agent-provider` (single package)                        | Add row: `agent-provider-*` (plural) → `agent-provider` (single package)                                                                    | Known rename: all `agent-provider-*` packages were consolidated into `agent-provider`, identical to the `agent-command` / `agent-plugin` consolidation pattern that is already documented |
| 31 (`useSideEffects` outbound deps)    | References `ITuiCliAdapter` with no owner package indicated                                      | Owner should be `agent-interface-tui`                                                                                                       | `ITuiCliAdapter` is a TUI interaction type contract; `agent-interface-tui` is the new package that owns TUI type contracts (e.g., `ITuiCommandInteraction`)                               |
| 59 (`TransportRegistry` outbound deps) | `agent-interface-transport` appears only as an outbound dep of `TransportRegistry`               | No dedicated inventory row exists for `agent-interface-transport` contracts                                                                 | The new `agent-interface-transport` package (type contracts for transport adapters) has no owned items listed in the inventory                                                            |
| 61 (`PrintTerminal` outbound deps)     | References `ITerminalOutput` with no owner package indicated                                     | Owner should be `agent-interface-tui`                                                                                                       | `ITerminalOutput` is a TUI-layer type contract; it belongs to `agent-interface-tui`                                                                                                       |

---

## Missing References

The following new packages have no rows where they appear as **Owner**:

- **`agent-interface-transport`** — owns transport adapter type contracts (e.g., `IConfigurableTransport`, `ITransportAdapter`). `IConfigurableTransport` is referenced as an outbound dep in lines 26 and 59 but has no inventory row. An `IConfigurableTransport` row with owner `agent-interface-transport` is missing.

- **`agent-interface-tui`** — owns TUI interaction type contracts (e.g., `ITuiCommandInteraction`, `ITuiCliAdapter`, `ITerminalOutput`). All three are referenced in outbound-dep columns (lines 31, 61) but none has an inventory row with owner `agent-interface-tui`.

- **`agent-subagent-runner`** — is present and correctly listed as owner for `ChildProcessSubagentRunner`, `createChildProcessSubagentRunnerFactory()`, `getDefaultSubagentWorkerPath()`, and `child-process-subagent-worker.ts` (lines 53–56). No gap here.

---

## Summary

The inventory is mostly accurate and up-to-date. The two main gaps are:

1. **Incomplete package name map**: The old→current rename table is missing the `agent-provider-*→agent-provider` consolidation and the `/http` and `/mcp` subpaths for `agent-transport`.

2. **Missing interface-layer packages**: The two new interface-contract packages (`agent-interface-transport`, `agent-interface-tui`) have no **owned** rows. Their contracts (`IConfigurableTransport`, `ITuiCliAdapter`, `ITerminalOutput`, and related TUI interaction types) are only mentioned as outbound dependencies in other rows, with no indication of which package owns them.

No rows were found with outright wrong package names (e.g., old name `agent-sdk` or `agent-sessions` still appearing as an owner). All owner columns in the inventory table use current package names.
