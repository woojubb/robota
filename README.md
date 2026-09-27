# Evidence for #3277 — Agent GUI usability audit (2026-09-27)

This orphan branch only holds evidence for the audit report on
[woojubb/robota#3277](https://github.com/woojubb/robota/issues/3277). It shares no history with the product
branches, runs no CI, and can be deleted once the follow-up issues are closed.

- Tested build: `origin/develop` at `ed629ec14` (packages `3.0.0-beta.83`), built from a clean worktree.
- Machine: macOS 27.0 (26A428), Apple silicon; Node 22.14.0; pnpm 8.15.4; Electron 43.2.0; Chrome 153 (Playwright
  `channel: chrome`).
- Provider: Anthropic `claude-sonnet-4-6` from the owner's own `~/.robota` profile (owner's choice). No key value appears
  here.

| Folder | Contents |
| --- | --- |
| `screenshots/` | Screenshots, resized to 1400 px. Prefixes: `s01`–`s12` scenario on the desktop app, `b-` browser (`robota --serve --open`), `cmd_` a slash command run in the desktop app. |
| `logs/` | Scripted e2e results, terminal output of the browser path, and the wire results of every slash command run in the GUI (`cmds-*.json`, `gui-slash-commands.json`). |
| `fixture/` | The disposable project the audit worked in, its history, and the changes the agent made during the audit. |
| `driver/` | The Playwright driver used to operate the app step by step and to record timings. |

The report itself, the findings, and the follow-up issues are on #3277.
