# BEHAVIOR-2003 — Contextual TUI key bindings and hot reload (agent-run)

**Spec:** `.agents/spec-docs/done/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md`
**Type:** agent-executable — the agent drives the Scenario 1 PTY run against the built CLI binary in an isolated environment; no live LLM, provider call, or credential required.

## Scenario

- **Product surface:** `robota-tui`
- **Command:** `pnpm exec robota --name keybindings-scenario` (executed via agent PTY driver `scratch/src/behavior-2003-pty-scenario.mts`)
- **Action flow:**
  1. Spawns 100×32 xterm-256color PTY with an isolated temporary `HOME` containing valid dummy configuration and `EDITOR` pointing to a recording test harness.
  2. Submits `/keybindings` to verify `EDITOR` receives the exact isolated `~/.robota/keybindings.json` path and the footer dynamically reflects `Ctrl+J Submit` from initial document.
  3. Sends `/he` and verifies slash-autocomplete accepts `Ctrl+J Complete`, and `Ctrl+J` executes `/help` rendering `Available commands:`.
  4. Atomically replaces `~/.robota/keybindings.json` with a valid document remapping `chat-input.submit` to `ctrl+k`.
  5. Verifies hot reload updates the footer to `Ctrl+K Submit`, while `/he` still completes with `Ctrl+J` and executes with `Ctrl+K` without session restart.
  6. Atomically replaces with an invalid document binding `ctrl+c` (reserved key).
  7. Verifies the invalid document is rejected atomically, a diagnostic names the failing path (`$.bindings.chat-input.submit: Ctrl+C is reserved for two-stage shutdown.`), the last valid configuration (`ctrl+k`) is preserved in the footer, `/help` still functions, and the TUI remains alive.
  8. Exits normally with `Ctrl+C`.

## Expected

- The editor receives the exact isolated `~/.robota/keybindings.json` path.
- The footer initially shows `Ctrl+J Submit`, and `/help` renders `Available commands:`.
- After the valid reload, the footer dynamically displays `Ctrl+K Submit`, and `/help` executes on `Ctrl+K`.
- After the invalid replacement, the error is surfaced, `Ctrl+K Submit` is retained, and the session does not crash.
- Clean exit with code 0.

## Observed (2026-09-19)

Live agent-controlled PTY execution output (`scratch/src/behavior-2003-pty-scenario.mts`):

```json
{
  "command": "node packages/agent-cli/bin/robota.cjs --name keybindings-scenario --disable-update-check --no-session-persistence",
  "terminal": "100x32 xterm-256color PTY",
  "editorPath": "<scenario-home>/.robota/keybindings.json",
  "expectedEditorPath": "<scenario-home>/.robota/keybindings.json",
  "exitCode": 0,
  "rawBytes": 65734,
  "strippedCharacters": 40478,
  "captures": {
    "editorOpened": [
      "Opened keybindings: <scenario-home>/.robota/keybindings.json",
      "Ctrl+J Submit"
    ],
    "initialCtrlJ": ["Ctrl+J Submit", "Available commands:", "Ctrl+J Submit"],
    "validCtrlK": ["Ctrl+K Submit", "Available commands:", "Ctrl+K Submit"],
    "invalidLastValid": [
      "Keybindings <scenario-home>/.robota/keybindings.json $.bindings.chat-input.submit: Ctrl+C is reserved for two-stage shutdown.",
      "Ctrl+K Submit",
      "Available commands:",
      "Ctrl+K Submit"
    ]
  }
}
```

### Supporting test suites

- `packages/agent-ui-terminal`: 98 test files passed, 866 tests passed
- `packages/agent-command`: 44 test files passed, 324 tests passed
- `packages/agent-cli`: 71 test files passed, 515 tests passed

✅ PASS — The contextual keybinding registry, file port, schema validation, live hot-reloading, last-valid rollback, and dynamic footer hint affordance are fully verified on the shipped TUI surface in a real PTY session.
