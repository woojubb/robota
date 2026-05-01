# Headless Update Check Policy

- **Status**: backlog
- **Created**: 2026-05-02
- **Priority**: medium
- **Scope**: packages/agent-cli, packages/agent-transport-headless

## Problem

Robota CLI currently has a startup update-check path that can be disabled with `--disable-update-check`. During headless verification, needing to pass this flag made the execution contract look wrong: print/headless mode should be a stable non-interactive execution path, not a startup UX surface.

Interactive CLI startup may show update notices, but `robota -p` and other headless transports should not perform startup update checks by default.

## Intent

- Keep update checking a CLI-owned feature, not an SDK feature.
- Preserve explicit manual update checks through `robota --check-update`.
- Skip automatic startup update checks for print/headless mode by default.
- Avoid requiring tests, scripts, or users to pass `--disable-update-check` just to get deterministic headless output.
- Keep stdout stable for `text`, `json`, and `stream-json` headless formats.

## Proposed Direction

1. Detect print/headless mode before scheduling `getStartupCliUpdateNotice()`.
2. Only schedule startup update checks for interactive TUI startup.
3. Keep `--disable-update-check` as an interactive startup opt-out.
4. Keep `--check-update` as the explicit manual check path in both interactive and non-interactive shells.
5. Add tests proving headless startup does not call the startup update-check utility and does not emit update notice stderr output.

## Acceptance Criteria

- `robota -p "prompt"` does not perform a startup update check by default.
- `robota -p --output-format json "prompt"` keeps stdout as result JSON only.
- `robota -p --output-format stream-json "prompt"` emits only stream/result events on stdout.
- `robota --check-update` still queries update metadata and prints the update command when applicable.
- No update-check policy values are written to project or user settings.

## Notes

This was discovered while running headless verification for subagent tool-call behavior. The observed workaround flag was `--disable-update-check`; the target behavior is that the flag is unnecessary for headless execution.
