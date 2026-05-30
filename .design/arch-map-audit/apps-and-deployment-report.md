# Audit Report: apps-and-deployment.md

## Stale References

| Line | Current text                                                      | Correct text                                                                                                                         | Reason                                                                                                                             |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 15   | `agent-web\nNext.js frontend host` (Mermaid node label)           | `agent-web\nNext.js frontend host` — app name is correct (`apps/agent-web`), but label should clarify it is the app, not the package | Minor ambiguity; `apps/agent-web` is still the actual app directory name, so this is acceptable as-is                              |
| 39   | `packages/agent-web-ui` (missing closing backtick in table cell)  | `` `packages/agent-web-ui` ``                                                                                                        | Typographic issue — backtick not closed                                                                                            |
| 40   | `packages/agent-web-ui.` (missing closing backtick in table cell) | `` `@robota-sdk/agent-web-ui` ``                                                                                                     | Backtick not closed; also inconsistent with the published package name used on line 44                                             |
| 44   | `@robota-sdk/agent-web`                                           | `@robota-sdk/agent-web-ui`                                                                                                           | Old package name. The package was renamed from `agent-web` to `agent-web-ui`. The npm scope must reflect the current package name. |
| 48   | `Keep \`agent-web\` deployable on a frontend platform.`           | `Keep \`apps/agent-web\` deployable on a frontend platform.`                                                                         | Ambiguous: without the `apps/` prefix this looks like the library package. Should use fully-qualified path.                        |
| 51   | `\`agent-web\` owns only the product route`                       | `\`apps/agent-web\` owns only the product route`                                                                                     | Same ambiguity as line 48 — unqualified `agent-web` is confusing given the existence of `packages/agent-web-ui`.                   |
| 54   | `\`agent-web\` and \`agent-server\` compose those packages`       | `\`apps/agent-web\` and \`apps/agent-server\` compose those packages`                                                                | Both should be fully-qualified to distinguish app paths from package names.                                                        |

## Missing References

- `apps/agent-web` correctly exists as an app directory and is referenced by the fully-qualified path in the deployment table (line 30), which is correct.
- `packages/agent-web-ui` is the current package name (renamed from `agent-web`). The disambiguation table on lines 35–44 partially acknowledges this but has inconsistent/incomplete backticks and uses the old npm identifier `@robota-sdk/agent-web` on line 44.
- No reference to `apps/blog` using its actual directory name (`apps/blog` vs the table entry `apps/blog` on line 33) — this is consistent and correct.
- `agent-server` in the deployment table (line 31) is listed without the `apps/` prefix, while `apps/agent-web` on line 30 has it. Should be `apps/agent-server` for consistency.

## Summary

The file is largely accurate. The main issues are:

1. **Wrong npm identifier on line 44**: `@robota-sdk/agent-web` should be `@robota-sdk/agent-web-ui` — this is a concrete stale name that reflects the old package name before the rename.
2. **Unclosed backticks on lines 39–40** in the disambiguation table, making the Markdown malformed.
3. **Ambiguous bare `agent-web` references on lines 48, 51, 54** — these should use the fully-qualified `apps/agent-web` path to distinguish the app from `packages/agent-web-ui`.
4. **`agent-server` on line 31** lacks the `apps/` prefix that `apps/agent-web` on line 30 has, creating inconsistency in the deployment table.

No references to fully removed package names (e.g., `agent-sdk`, `agent-sessions`, `agent-transport-tui`, individual `agent-provider-*` or `agent-plugin-*` packages) were found in this file.
