# SCREEN-1992 — Recap an unattended session and background activity (agent-run)

**Spec:** `.agents/spec-docs/done/SCREEN-1992-recap-unattended-session-and-background-activity.md`
**Type:** agent-executable — the agent drives the Scenario 1 PTY run against the built CLI binary with an isolated HOME and a local stub provider; no live LLM, provider call, or credential required.

## Scenario

- **Product surface:** `robota-tui`
- **Command:** `pnpm exec robota --name recap-scenario` (executed via agent PTY driver `scratch/src/screen-1992-recap-scenario.mts`, `RECAP_SCENARIO_STRICT=1`)
- **Action flow:**
  1. Starts a local OpenAI-compatible stub (`POST /v1/chat/completions`, SSE, one canned reply; the wake turn's reply is held for 4 s so the turn is observably in progress) and an isolated `HOME` whose `openai`-type profile points at it.
  2. Spawns the built CLI in a 100×32 xterm-256color PTY with `NO_COLOR=1`; both streams are TTYs, so focus reporting is negotiated.
  3. Submits `hello` and waits for the canned reply.
  4. Submits `/schedule in 1m say hello`, then samples the background row's `in Ns` countdown for 6 s.
  5. Writes `ESC [ O` (focus-out). When the stub receives the wake turn, opens the switcher with `Ctrl+B`, reads the main-thread row, closes it with `Esc`, and waits for the wake reply.
  6. Writes `ESC [ I` (focus-in) and reads the recap; then writes a second `ESC [ O` / `ESC [ I` pair with nothing in between.
  7. Exits with `Ctrl+C`; the stub and the isolated directories are removed.

## Expected

- After `/schedule`, the background row shows `working` and a countdown that decreases at least twice.
- During the wake turn the main-thread row reads `working`.
- `ESC [ I` renders exactly one `While away` line naming 1 turn finished (1 wake).
- The schedule row reads `completed` after its one-shot fire.
- The second focus-out/in with no activity renders no further `While away` line.
- Clean exit with code 0.

## Observed (2026-09-19)

Live agent-controlled PTY execution output (`scratch/src/screen-1992-recap-scenario.mts`, strict mode — every check below throws on mismatch):

```json
{
  "command": "node packages/agent-cli/bin/robota.cjs --name recap-scenario --disable-update-check --no-session-persistence",
  "terminal": "100x32 xterm-256color PTY",
  "stub": {
    "requests": [
      {
        "path": "POST /v1/chat/completions",
        "stream": true,
        "lastUserContent": "hello",
        "at": "2026-09-19T01:34:58.793Z"
      },
      {
        "path": "POST /v1/chat/completions",
        "stream": true,
        "lastUserContent": "say hello",
        "at": "2026-09-19T01:35:59.005Z"
      }
    ]
  },
  "scheduleDelay": "1m",
  "exitCode": 0,
  "harness": {
    "cliStarted": true,
    "providerTurnCompleted": true,
    "scheduleRowAppeared": true,
    "wakeFired": "say hello"
  },
  "checks": [
    {
      "name": "countdown decreases at least twice after /schedule",
      "observed": "[58,57,56,55,54,53,52]",
      "matched": true
    },
    {
      "name": "schedule row shows `working` before the wake",
      "observed": "└ ⟳ working Scheduled: say hello · sleeping · scheduled · ↻ wake \"say hello\" · say hello · in 55s",
      "matched": true
    },
    {
      "name": "main-thread row shows `working` during the wake turn",
      "observed": "│ > ● working Main thread · active · 5 history entries · user │",
      "matched": true
    },
    {
      "name": "exactly one `While away` line on focus-in",
      "observed": "While away <1m: 1 turn finished (1 wake) · 1 completed",
      "matched": true
    },
    {
      "name": "schedule row reads `completed` after the one-shot fire",
      "observed": "└ ✓ completed Scheduled: say hello · completed · scheduled · …",
      "matched": true
    },
    { "name": "no second recap for an empty interval", "observed": "[]", "matched": true }
  ]
}
```

The interval was under a minute (`<1m`) because the driver focuses out only after sampling the countdown; a longer interval renders `12m`, `1h 30m` per `formatElapsed` (unit-tested).

### Supporting test suites

- `packages/agent-ui-terminal`: 104 test files passed, 882 tests passed
- `packages/agent-framework` (`src/background-tasks`, `src/interactive/__tests__/session-prompt-registry.test.ts`, `interactive-session-prompt-flow.test.ts`): 43 tests passed
- `packages/agent-executor` (`src/background-tasks`): 75 tests passed
- `packages/agent-cli` (`src/startup`): 111 tests passed

✅ PASS — focus-driven attention, the one-line interval recap, the state word on every row, the live countdown and the one-shot schedule's terminal `completed` are verified on the shipped TUI in a real PTY session.
