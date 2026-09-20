# BEHAVIOR-2437 — First-class `/git status`, `/git diff` and `/git commit` (agent-run)

**Spec:** `.agents/spec-docs/done/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`
**Type:** agent-executable — the agent drives the four scenarios against the built CLI binary through
`packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts`: three in a real
`xterm-256color` PTY with an isolated HOME over a throwaway git repository, one in print mode. No live
LLM, provider call, or credential is required — only slash commands run.

## Scenarios

- **Product surface:** `robota-tui` (S1–S3), `robota-cli` (S4)
- **Command:** `pnpm exec robota --name git-scenario` (spawned by the ptytest as the workspace
  `packages/agent-cli/bin/robota.cjs` under `process.execPath`); S4:
  `robota trust --yes` then `robota -p "/git commit feat: add greeting" --bare --no-session-persistence`
- **Fixture:** `git init -b main`, local identity, one commit holding `greeting.txt` and `notes.txt`;
  then `greeting.txt` edited and staged (S1, S2, S4 — not S3), `notes.txt` edited unstaged,
  `scratch.log` untracked. Hermetic git: isolated HOME, `GIT_CONFIG_NOSYSTEM=1`, signing off.
- **Action flow (S1):** `/help`; `/status ` (a trailing space closes the autocomplete popup — with
  it open, Enter runs the highlighted `/statusline` entry, so the literal `/status` cannot be
  submitted otherwise); `/git status`; `/git diff`; `/git diff --staged`; `/git diff -- notes.txt`;
  `/git diff HEAD~1`; `/git diff nosuchrev`; `/git diff --output=x`; `/exit` → Yes.
- **Action flow (S2):** `/git commit add greeting`; `/git commit feat: add greeting` → Down, Enter
  (No); `/git commit "feat: add greeting"` → Down, Up, Enter (Yes); `/exit` → Yes.
- **Action flow (S3):** `/git commit feat: nothing to commit`; `/exit` → Yes.
- **Action flow (S4):** the print-mode command above with `TERM=dumb` and no provider key.

## Expected

The spec's four expected observables: the read commands report the fixture and change nothing; the
commit path refuses a non-conventional subject, commits nothing on No, and on Yes commits exactly the
staged file; nothing staged yields guidance with the counts; headless cancels with exit 1.

## Observed (2026-09-20)

Run: `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts
src/__tests__/pty/behavior-2437-git.ptytest.ts` against the workspace build. **Exit 0 — 4 of 4
scenarios** (19.1 s). Every check throws on mismatch.

- **S1** — `/help` printed a `/git` line; `/status` answered `Unknown command "/status"`;
  `/git status` printed `On branch main`, `staged (1): greeting.txt`, `unstaged (1): notes.txt`,
  `untracked (1): scratch.log`; `/git diff` showed `+note two` and not `+hello world`; `--staged`
  the reverse; `-- notes.txt` showed `+note two` with no `greeting.txt` header; `HEAD~1` and
  `nosuchrev` were refused by name (`Unknown revision: …`) with no `diff --git`; `--output=x`
  printed the usage naming `--staged`, `<rev>`, `<a>..<b>`, `-- <path>` with no diff, and no `x`
  file was created; `/exit` exited 0; afterwards one commit and `M  greeting.txt`, ` M notes.txt`,
  `?? scratch.log`.
- **S2** — `add greeting` → `Commit refused: the subject has no `: ` type separator …`, no dialog,
  one commit; `feat: add greeting` → `Commit 1 staged file(s)?` with `Message: feat: add greeting`
  and `M greeting.txt` only; No → `Commit cancelled.`, one commit; the quoted form showed the message
  without quotes; Yes → `Committed: [main <7-hex>] feat: add greeting`; afterwards two commits, HEAD
  subject `feat: add greeting`, `git show --stat` lists `greeting.txt` only (`1 file changed`),
  porcelain ` M notes.txt` and `?? scratch.log`.
- **S3** — `Nothing is staged (1 unstaged, 1 untracked). Stage files with `git add`or`/shell git
  add ...`and run`/git commit` again.`, no dialog; one commit; porcelain unchanged.
- **S4** — exit 1; output contained `cancelled` and `confirmation`, no `Yes`/`No` prompt; one commit;
  `M  greeting.txt` still staged.

## Notes

The confirmation picker used to start on its first option (`Yes`) because the single-select renderer
ignored `confirmAction`'s `defaultYes: false`; this change seeds `ListPicker` from the request's
declared default (`PendingActionPrompt.tsx`, regression test in `PendingActionPrompt.test.tsx`), so a
bare Enter on the commit dialog answers No. The scenario still moves the highlight by the rendered
label rather than by an assumed index. `pnpm exec robota` on this host resolves to a global install;
the ptytest spawns the workspace binary by path, which is the build measured.
