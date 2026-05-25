# Audit Report: agent-cli/layering-audit.md

Source file: `.agents/specs/architecture-map/agent-cli/layering-audit.md`
Audited: 2026-05-18 against `develop` branch.

---

## Stale References

| Line          | Current text                                                    | Correct text                                                                  | Reason                                                                                                                                         |
| ------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 63            | `agent-cli/src/background/managed-shell-process-runner.ts`      | `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts` | File has moved from `agent-cli` to `agent-executor`. No `background/` directory exists under `agent-cli/src/`.                                 |
| 63 (same row) | Classification: `CLI adapter — Node spawn, stdin, cancellation` | `Executor adapter — Node spawn, stdin, cancellation`                          | The file now lives in `agent-executor`, not `agent-cli`. Classification "CLI adapter" is incorrect; ownership transferred to `agent-executor`. |

### Notes on non-stale items

The following were checked and are **not** stale:

- **CLI-AUDIT-001** (`agent-framework/src/interactive/session-persistence.ts`): File exists at that path. A second file `interactive-session-persistence.ts` also exists alongside it; these are distinct files. Reference is accurate.
- **CLI-AUDIT-002** (`agent-transport/src/tui/command-interaction.ts`): File confirmed at `packages/agent-transport/src/tui/command-interaction.ts`.
- **CLI-AUDIT-007** (`@robota-sdk/agent-session` pass-through guard): `agent-session` is the current package name (renamed from `agent-sessions`). Correct.
- **CLI-AUDIT-007** (`packages/agent-framework/docs/PUBLIC-SURFACE.md`): File confirmed present.
- **CLI-AUDIT-007** (`agent-framework/src/background-tasks/index.ts`, `agent-framework/src/subagents/index.ts`): Both confirmed present.
- **CLI-AUDIT-010** (`packages/agent-transport/src/tui/create-default-tui-cli-adapter.ts`): File confirmed present.
- **CLI-AUDIT-013** (`src/startup/provider-startup.ts`): New file confirmed; old `src/utils/provider-setup.ts` confirmed deleted.
- **CLI-AUDIT-018** (`packages/agent-transport/src/headless/print-terminal.ts`): File confirmed present.
- **CLI-AUDIT-019** (`packages/agent-transport/src/transport-registry.ts`): File confirmed present; `agent-cli/src/transports/` directory confirmed deleted.
- **CLI-AUDIT-020** (`packages/agent-provider/src/default-provider-definitions.ts`): File confirmed present.
- **CLI-AUDIT-021** (`packages/agent-transport/src/headless/cli-input.ts`): File confirmed present.
- **CLI-AUDIT-022** (`agent-subagent-runner` package files): All four files confirmed present under `packages/agent-subagent-runner/src/`. `agent-framework/src/subagents/` retains only `in-process-subagent-runner.ts` and `index.ts` — `child-process-subagent-runner.ts` confirmed removed.
- **CLI-AUDIT-023** (`packages/agent-command/src/plugins/default-plugin-command-adapter.ts`, `default-plugin-command-source-loader.ts`): Both confirmed present; `agent-cli/src/plugins/` directory confirmed deleted.
- All `@robota-sdk/` package name references use current names (`agent-framework`, `agent-session`, `agent-transport`, `agent-provider`, `agent-command`, `agent-subagent-runner`).

---

## Missing References

- **CLI-AUDIT-006 table is incomplete**: `managed-shell-process-runner.ts` moved to `agent-executor` but this is not documented in CLI-AUDIT-006. There is no follow-on audit item that records this reclassification.
- **No entry covers `agent-cli/src/background/` directory removal**: The table in CLI-AUDIT-006 implies the `background/` directory still exists in `agent-cli`. There is no audit item documenting when/why that directory was eliminated and where its contents moved.

---

## Summary

One stale file path was found in the CLI-AUDIT-006 ownership table (line 63). The file `managed-shell-process-runner.ts` is listed as living at `agent-cli/src/background/managed-shell-process-runner.ts` with classification "CLI adapter", but its actual location is `agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts`. Both the path and the ownership classification are stale.

All other package name references (`@robota-sdk/` scopes, `packages/` paths, renamed packages) are current. No stale uses of old names (`agent-sdk`, `agent-sessions`, individual `agent-command-*` or `agent-provider-*` sub-packages) were found. The six resolved audit items with concrete file movements (CLI-AUDIT-010, 013, 018, 019, 020, 021, 022, 023) all have their target paths verified as present in the codebase.
