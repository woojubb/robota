# Audit Report: agent-cli-composition.md

Source file: `.agents/specs/architecture-map/agent-cli-composition.md`
Audited on: 2026-05-18
Verified against: `packages/` directory listing

---

## Stale References

| Line | Current text                                                                                                          | Correct text     | Reason                                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15   | `sessions` (in prose enumeration: "CLI, SDK, command packages, providers, runtime, sessions, tools, or core")         | `session`        | Package was renamed from `agent-sessions` (plural) to `agent-session` (singular). The prose category should reflect the current singular package name.                                         |
| 51   | `sessions` (in prose enumeration: "CLI, SDK, command packages, provider packages, runtime, sessions, tools, or core") | `session`        | Same issue as line 15 — old plural form no longer matches `@robota-sdk/agent-session`.                                                                                                         |
| 51   | `provider packages` (plural, implying multiple `agent-provider-*` packages)                                           | `agent-provider` | All individual `agent-provider-*` packages were consolidated into a single `@robota-sdk/agent-provider` package. Using plural "provider packages" implies the old pre-consolidation structure. |
| 51   | `command packages` (plural)                                                                                           | `agent-command`  | All individual `agent-command-*` packages were consolidated into a single `@robota-sdk/agent-command` package.                                                                                 |
| 15   | `command packages` (in same enumeration)                                                                              | `agent-command`  | Same as line 51 — post-consolidation there is one `agent-command` package, not multiple.                                                                                                       |

**Note on line 55 (`agent-framework`):** This reference is correct. The package was renamed from `agent-sdk` to `agent-framework` and the document already uses the new name — no stale reference here.

**Note on line 47 (hook file paths):** All three referenced files exist at their stated paths:

- `packages/agent-transport/src/tui/hooks/useInteractiveSession.ts` — exists
- `useSlashRouting.ts` — exists
- `useSideEffects.ts` — exists

**Note on line 46 (`packages/agent-cli/src/cli.ts`):** File exists — no issue.

---

## Missing References

The governance section (lines 44–58) enumerates packages that trigger architecture map updates but omits several packages that interact with CLI composition:

- **`agent-interface-transport`** — defines transport interfaces used by `agent-cli`; changes to its contracts affect CLI composition. Not mentioned anywhere in the governance triggers.
- **`agent-interface-tui`** — defines TUI interfaces; structural changes affect the TUI hook layer referenced on line 47. Not mentioned.
- **`agent-subagent-runner`** — subagent runner was moved from `agent-sdk` to `agent-cli` (see commit `f83c40917`). Its CLI-layer integration is not acknowledged in the governance trigger list.
- **`agent-session`** — the new singular package name should appear in the trigger list in place of the stale plural "sessions" category.

---

## Summary

The file has no hard stale package name backtick references of the form `` `agent-sdk` `` or `` `agent-sessions` ``. All explicit `@robota-sdk/` scoped names (`agent-cli`, `agent-command`, `agent-framework`) are correct.

The stale content is confined to informal prose enumerations (lines 15 and 51) that use:

1. The old plural `sessions` instead of the current singular `agent-session`.
2. The old plural `provider packages` / `command packages` implying multiple consolidated packages that are now each a single package.

Additionally, four packages relevant to CLI composition (`agent-interface-transport`, `agent-interface-tui`, `agent-subagent-runner`, `agent-session`) are absent from the governance trigger list on lines 44–58.

No changes to linked sub-documents (`agent-cli/*.md`) were evaluated in this audit — each sub-document should be audited separately.
