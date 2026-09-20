# SCREEN-2670 — Queue screen-reader frames with a pre-write park (agent-run)

**Spec:** `.agents/spec-docs/done/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md`
**Type:** agent-executable — the agent drives the scenario against the built CLI binary through
`packages/agent-ui-terminal/src/__tests__/pty/screen-2670-prepark.ptytest.ts`, in a real 100×32
`xterm-256color` PTY with an isolated HOME and a `--session-log` replay fixture. No live LLM,
provider call, or credential is required.

## Scenario

- **Product surface:** `robota-tui`
- **Command:** `pnpm exec robota --name prepark-scenario` (spawned by the ptytest as the workspace
  `packages/agent-cli/bin/robota.cjs` under `process.execPath`, with `--session-log
fixtures/replay-conversation.jsonl` and `--screen-reader`)
- **Action flow:** wait for the prompt; let startup frames settle; sample the RAW byte stream every
  5 ms, stamping every growth (growths within 30 ms are one burst — a PTY read can split one
  contiguous write); type `hello` with the driver's key pacing and send Enter immediately after the
  last echo, so the exempt echo commit and the parked turn commit are provoked within milliseconds
  of each other; measure (typed → echo) and (echo → answer); run the same flow with
  `ROBOTA_SCREEN_READER_PREPARK_MS=0` and with the mode off.

## Expected

The spec's Scenario 1 observable: the echo is not delayed; the turn's commit arrives at least the
interval after the previous printable release; the chunks of that commit are contiguous (the
synchronized-output window opens and closes in one burst); the OSC 133 prompt-start precedes the
answer; with `=0` no delay; with the mode off no delay and the bordered UI as before.

## Observed (2026-09-20)

Run: `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts
src/__tests__/pty/screen-2670-prepark.ptytest.ts` against the workspace build. **Exit 0 — 3 of 3
cases, and again 3 of 3 on an immediate second run.** Every check throws on mismatch.

- **park 250 ms** — the `hello` echo landed less than 190 ms (the interval minus slack) after the
  keys were sent; the answer burst landed at least 190 ms after the echo burst; that burst contained
  `\x1b[?2026h` … `REPLAYED_ANSWER_42` … `\x1b[?2026l` — one synchronized-output window, whole;
  the mount-time `\x1b]133;A\x07` precedes the answer in the raw stream.
- **park 0** — the answer burst followed the echo burst in under 190 ms: no interval injected.
- **mode off** — the same, and the snapshot carries the box-drawing chrome (`│─╭╮╰╯…`), so the
  proxy is absent and the pre-change rendering is intact.

## Notes

The reply is replayed as a single chunk (`agent-provider-replay` yields the recorded response
whole), so a turn is ONE commit: the interval is observed between the exempt echo commit and the
turn commit, not between streamed tokens, and the turn's own B/C/D marks are not observable (their
ordering against a parked batch is pinned by `screen-reader-turn-marks-port.test.tsx` and the
control-only rule in `screen-reader-stdout.test.ts`). `pnpm exec robota` on this host resolves to a
global 3.0.0-beta.72; the ptytest spawns the workspace binary by path, which is the build measured.
