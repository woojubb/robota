# Audit Report: agent-cli/execution-modes.md

Source file: `.agents/specs/architecture-map/agent-cli/execution-modes.md`
Audited on: 2026-05-18

## Stale References

| Line | Current text          | Correct text             | Reason                                             |
| ---- | --------------------- | ------------------------ | -------------------------------------------------- |
| 70   | `agent-web (browser)` | `agent-web-ui (browser)` | Package renamed from `agent-web` to `agent-web-ui` |

## Correct References (verified)

- Line 44, 50: `agent-transport/headless` — correct subpath for the consolidated `agent-transport` package
- Line 69: `agent-transport/ws` — correct subpath for the consolidated `agent-transport` package
- Lines 15, 46, 55: `agent-session` — correct current name (renamed from `agent-sessions`)
- No stale `agent-sdk` references (current name: `agent-framework`)
- No stale standalone `agent-transport-tui` or `agent-transport-headless` references

## Missing References

- The WebSocket Sidecar Mode diagram does not reference `agent-web-ui` package path or its docs/SPEC.md, unlike the other two sections which link to `packages/agent-cli/docs/SPEC.md`. A cross-reference to `packages/agent-web-ui/docs/SPEC.md` may be worth adding for completeness, though it is not strictly required.

## Summary

One stale package name found: line 70 uses `agent-web (browser)` but the package has been renamed to `agent-web-ui`. All transport subpath references (`agent-transport/headless`, `agent-transport/ws`) are correct for the consolidated transport package. The `agent-session` name (renamed from `agent-sessions`) is used correctly throughout. No other stale names from the known rename list are present.
