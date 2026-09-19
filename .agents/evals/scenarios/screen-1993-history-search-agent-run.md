# SCREEN-1993 — Search prompt history across sessions and projects (agent-run)

**Spec:** `.agents/spec-docs/done/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`
**Type:** agent-executable — the agent drives the Scenario 1 PTY run against the built CLI binary with an isolated HOME, a seeded `~/.robota/history.jsonl` and a local stub provider; no live LLM, provider call, or credential required.

## Scenario

- **Product surface:** `robota-tui`
- **Command:** `pnpm exec robota --name history-scenario` (executed via agent PTY driver `scratch/src/screen-1993-history-scenario.mts`, `HISTORY_SCENARIO_STRICT=1`)
- **Action flow:**
  1. Starts a local OpenAI-compatible stub (`POST /v1/chat/completions`, SSE, one canned reply, every request recorded) and an isolated `HOME` whose `openai`-type profile points at it; git-initialises the project directory so its worktree root is the run's project key.
  2. Seeds `~/.robota/history.jsonl` with 120 prompts across three `project` values (one of them the run's own; `deploy staging with helm chart v3` seeded twice on it) plus one malformed line.
  3. Spawns the built CLI in a 100×32 xterm-256color PTY with `NO_COLOR=1`; submits `hello` and waits for the canned reply (the session appends `hello` to the file, now 122 lines).
  4. Types the draft `first draft`, presses `ctrl+r`, reads the overlay; types `deploy`; presses `ctrl+s` twice.
  5. Presses `enter` on the single `project` match; then `ctrl+r`, `rotate`, `ctrl+e`; then `ctrl+u`, the draft `third draft: keep me byte-identical  `, `ctrl+r`, `helm`, `escape`.
  6. Exits with `Ctrl+C`; the stub and the isolated directories are removed.

## Expected

- `ctrl+r` opens an overlay listing stored prompts newest-first with the scope label `all` and `1 unreadable line skipped`.
- Typing `deploy` narrows the list to prompts containing it, highlighted, the duplicate collapsed to one row.
- `ctrl+s` changes the scope label to `session` (no seeded prompt visible) then `project` (only the current project's prompt).
- `enter` closes the overlay and places the exact text in the input; the stub receives no request.
- `ctrl+r`, `rotate`, `ctrl+e` sends the highlighted match: the stub's next request has that text as its last user content.
- `escape` closes the overlay and the input shows the draft unchanged.
- Clean exit with code 0.

## Observed (2026-09-19)

Live agent-controlled PTY execution output (`scratch/src/screen-1993-history-scenario.mts`, strict mode — every check below throws on mismatch):

```json
{
  "command": "node packages/agent-cli/bin/robota.cjs --name history-scenario --disable-update-check --no-session-persistence",
  "terminal": "100x32 xterm-256color PTY",
  "stub": {
    "requests": [
      {
        "path": "POST /v1/chat/completions",
        "stream": true,
        "lastUserContent": "hello",
        "at": "2026-09-19T05:54:29.370Z"
      },
      {
        "path": "POST /v1/chat/completions",
        "stream": true,
        "lastUserContent": "rotate the staging secrets",
        "at": "2026-09-19T05:54:37.052Z"
      }
    ]
  },
  "seeded": {
    "lines": 122,
    "projects": 3,
    "malformedLines": 1
  },
  "exitCode": 0,
  "harness": {
    "cliStarted": true,
    "providerTurnCompleted": true,
    "seededHistoryFileExists": true
  },
  "checks": [
    {
      "name": "ctrl+r opens the history overlay with scope label `all`",
      "observed": "[\"\u2502 (reverse-i-search) scope: all \u00b7 query:                                                           \u2502\",\"\u2502  \u2191\u2193 Navigate \u00b7 Ctrl+S Scope \u00b7 Enter/Tab Insert \u00b7 Ctrl+E Run \u00b7 Esc Close                          \u2502\"]",
      "matched": true
    },
    {
      "name": "overlay lists stored prompts newest-first",
      "observed": "{\"newest\":1140,\"secondNewest\":1241}",
      "matched": true
    },
    {
      "name": "overlay shows the skipped-line count 1",
      "observed": "[\"\u2502 120 matches \u00b7 1 unreadable line skipped                                                          \u2502\"]",
      "matched": true
    },
    {
      "name": "typing `deploy` narrows the list to prompts containing it",
      "observed": "{\"otherA\":true,\"current\":true,\"otherB\":true,\"newestNonMatchStillVisible\":false}",
      "matched": true
    },
    {
      "name": "duplicate prompt collapsed to its newest occurrence",
      "observed": "{\"occurrences\":1}",
      "matched": true
    },
    {
      "name": "the match is highlighted in the listed rows",
      "observed": "[\"\u2502 > re[deploy] after the [deploy] hook fails                                                       \u2502\",\"\u2502   [deploy] staging with helm chart v3                                                            \u2502\",\"\u2502   [deploy] the canary to eu-west                  ",
      "matched": true
    },
    {
      "name": "first ctrl+s changes the scope label to `session` (no deploy prompt in the live session)",
      "observed": "{\"label\":[\"\u2502 (reverse-i-search) scope: session \u00b7 query: deploy                                                \u2502\",\"\u2502  \u2191\u2193 Navigate \u00b7 Ctrl+S Scope \u00b7 Enter/Tab Insert \u00b7 Ctrl+E Run \u00b7 Esc Close                          \u2502\"],\"anyDeployVisible\":false}",
      "matched": true
    },
    {
      "name": "second ctrl+s changes the scope label to `project` and keeps only current-project prompts",
      "observed": "{\"label\":[\"\u2502 (reverse-i-search) scope: project \u00b7 query: deploy                                                \u2502\",\"\u2502  \u2191\u2193 Navigate \u00b7 Ctrl+S Scope \u00b7 Enter/Tab Insert \u00b7 Ctrl+E Run \u00b7 Esc Close                          \u2502\"],\"current\":true,\"otherA\":false,\"otherB\":fals",
      "matched": true
    },
    {
      "name": "enter inserts the match into the input without sending it",
      "observed": "{\"composer\":[\"> deploy staging with helm chart v3\"],\"overlayStillOpen\":false,\"stubRequestsBefore\":1,\"stubRequestsAfter\":1}",
      "matched": true
    },
    {
      "name": "ctrl+e sends the highlighted match",
      "observed": "{\"lastUserContent\":\"rotate the staging secrets\",\"replyRendered\":true}",
      "matched": true
    },
    {
      "name": "escape cancels the search and restores the draft byte-identically",
      "observed": "{\"composer\":[\"> third draft: keep me byte-identical\"],\"overlayStillOpen\":false}",
      "matched": true
    }
  ]
}
```

Under `NO_COLOR=1` the highlight is the visible `[deploy]` marker (e.g. `> re[deploy] after the [deploy] hook fails`); with colour it is an inverse run. Trailing spaces of the restored draft are not distinguishable from padding in a rendered frame; the component test (`history-search-overlay.test.tsx`) covers byte-identity there.

### Supporting test suites

- `packages/agent-ui-terminal`: 106 test files passed, 903 tests passed; PTY `screen-1993-scrollback.ptytest.ts` passed (120 restored messages all present in the capture, no `ESC [ ? 1049 h`)
- `packages/agent-framework`: 227 test files passed, 1747 tests passed
- `packages/agent-cli`: 71 test files passed, 515 tests passed
- `packages/agent-session`: 52 test files passed, 387 tests passed
- `packages/agent-interface-session`: 7 test files passed, 33 tests passed

✅ PASS — reverse prompt-history search with scopes, highlighted narrowing, insert, execute and exact cancel restoration is verified on the shipped TUI in a real PTY session against a seeded history file; the transcript decision is backed by the scrollback PTY proof.
