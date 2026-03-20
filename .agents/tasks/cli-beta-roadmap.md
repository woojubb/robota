---
title: CLI Beta Roadmap
status: in-progress
created: 2026-03-20
branch: release/v3.0.0-beta.1
---

# CLI Beta Roadmap

Ordered work items for v3.0.0-beta releases. Each item maps to a backlog file with full details.

## Work Order

| #   | Item                                    | Backlog                                     | Status  | Beta   |
| --- | --------------------------------------- | ------------------------------------------- | ------- | ------ |
| 1   | Fix context window tracking             | `backlog/fix-context-tracking.md`           | done    | beta.2 |
| 2   | Cancel execution (Esc/Ctrl+C)           | `backlog/cli-cancel-execution.md`           | done    | beta.2 |
| 3   | WebFetch / WebSearch tools              | `backlog/sdk-webfetch-tool.md`              | done    | beta.3 |
| 4   | Permission remember choice              | `backlog/sdk-permission-remember-choice.md` | done    | beta.3 |
| 5   | Context management & compaction         | `backlog/sdk-context-management.md`         | pending | beta.4 |
| 6   | Slash command autocomplete improvements | `backlog/cli-slash-autocomplete.md`         | pending | beta.4 |
| 7   | Tool output size limits tuning          | `backlog/tool-output-size-limits.md`        | pending | beta.5 |

## Completion Criteria

Each item:

1. Implementation complete
2. Build passes (`pnpm build && pnpm typecheck`)
3. Committed to `release/v3.0.0-beta.1` branch
4. Beta version published for milestone items

## Notes

- Beta grouping is tentative — adjust as needed during implementation.
- Each beta publish follows the Publish Registry in `project-structure.md` (6 packages only).
- OTP must be requested only after all build/dry-run preparation is complete.
