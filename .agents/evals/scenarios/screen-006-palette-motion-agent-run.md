# SCREEN-006 — shared TUI palette & tokenized motion: agent-run User Execution evidence

Spec: `.agents/spec-docs/active/SCREEN-006-tui-shared-palette-and-motion.md`
Run by the agent (no owner terminal smoke), 2026-07-25, on the rebuilt `robota` binary
(`packages/agent-cli/bin/robota.cjs` after `pnpm build` of `agent-transport-tui` + `agent-cli`).

## Scenario 1 — NO_COLOR legibility

Command: `pnpm --filter @robota-sdk/agent-transport-tui test:pty`
Backing test: `src/__tests__/pty/screen-006-no-color.ptytest.ts` **S1** — spawns the built CLI in a
real pty with `NO_COLOR=1` and `--session-log` replay, drives a full turn, then scans the ENTIRE
raw transcript for SGR color params (30-38/39/40-49/90-97/100-107, incl. 38;5/48;5 extended).

Result (2026-07-25):

```text
✓ SCREEN-006 color/motion through the real binary > S1: NO_COLOR=1 → legible output,
  zero SGR color sequences, no animation  1083ms
```

- Output legible: `You:` / `REPLAYED_ANSWER_42` present in the stripped frames.
- Zero SGR color sequences in the whole transcript ⇒ zero WaveText color churn (the
  `isInteractiveColorTerminal()` gate creates no interval, and no color byte ever reached the pty).
- RED first: before the fix the same scan found **184 SGR color params** (chalk 5 does not
  implement NO_COLOR — its vendored supports-color reads only FORCE_COLOR/TTY/TERM), fixed by the
  one-line gate sync in `src/render.tsx` (`chalk.level = 0` when the gate is off).

## Scenario 2 — normal-run consistency

Backing test: `src/__tests__/pty/screen-006-no-color.ptytest.ts` **S2** — color on, replayed Shell
tool (allowed) + markdown diff response.

Result (2026-07-25):

```text
✓ SCREEN-006 color/motion through the real binary > S2: color on → tool summary uses the
  palette status color, labels use accent, diff uses tui-ansi-palette  1006ms
```

- Persisted tool summary renders the SSOT glyph in the palette status color:
  `✓ Shell` inside `ESC[32m` (`STATUS_GLYPH.success` ← `PALETTE.status.success`).
- Assistant label `Robota:` renders the accent token (`ESC[36m`).
- Markdown diff block carries the `tui-ansi-palette` SGR pair (`48;5;22` + `38;5;120`).

**Recorded reachability limit:** a permission DENY short-circuits before tool-start, so the
framework (`interactive-session-streaming.ts`) emits no `tool-summary` entry for a denied-at-prompt
tool — the pty run cannot surface the persisted denied glyph end-to-end. The denied `yellowBright`
unification (the SCREEN-006 drift fix) is pinned at component level instead:
`message-list-rendering.test.tsx` "denied tool summary renders the STATUS_GLYPH.denied color
(yellowBright)" — **RED before the fix** (the deleted hand-rolled mapping rendered `ESC[33m` plain
yellow), GREEN after.

## Gate runs (all agent-run, 2026-07-25)

- `pnpm --filter @robota-sdk/agent-transport-tui test` → 68 files, **525 passed**.
- `pnpm --filter @robota-sdk/agent-transport-tui test:pty` → 12 files, **19 passed** (full suite).
- `pnpm -w typecheck` → clean.
- `node scripts/harness/run-all-scans.mjs` → **all 60 scans passed**.
