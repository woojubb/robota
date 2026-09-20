# FLOW-2006 — Launch a safe prefilled local session from a deep link (agent-run)

**Spec:** `.agents/spec-docs/active/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`
**Type:** agent-executable — the agent drives the three scenarios against the built CLI binary through
`packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts`: one in a real
`xterm-256color` PTY with an isolated HOME over throwaway git repositories, two as headless process
runs. No live LLM, provider call, or credential is required — every observable is a rendered frame,
a stderr line, an exit code, or a file on disk.

## Scenarios

- **Product surface:** `robota-tui` (S1), `robota-cli` (S2, S3)
- **Command:** `robota open '<robota://open?v=1&prompt=…&cwd=…>'` (spawned by the ptytest as the
  workspace `packages/agent-cli/bin/robota.cjs` under `process.execPath`)
- **Fixture:** an isolated `HOME` holding `.robota/settings.json` with a dummy `anthropic` profile
  and `.robota/onboarded` (the first-run welcome is onboarding, not what these scenarios observe);
  `trusted/` and `untrusted/` are git repositories with one `chore: fixture` commit each, `elsewhere/`
  is the unrelated directory every command is launched FROM, so the change of directory is
  observable. `robota trust --yes` is run once in `trusted/` only. Hermetic git: isolated HOME,
  `GIT_CONFIG_NOSYSTEM=1`, signing off.
- **Action flow (S1):** launch `robota open '<link>' --name flow2006` from `elsewhere/`; read the
  first frame without typing; press Enter exactly once.
- **Action flow (S2):** nine headless invocations with `TERM=dumb` — the unknown key `provider`, a
  duplicate `prompt`, a missing `v`, `v=2`, a `/mode bypassPermissions` prompt, a relative `cwd`, a
  `cwd` with a `..` segment, a `cwd` that does not exist, and a second link appended to argv.
- **Action flow (S3):** the untrusted directory as `cwd=`, then `repo=nobody/not-a-clone`.

## Expected

The spec's three expected observables: the link opens the trusted repository with the prompt
prefilled, unsent and labelled, and only Enter submits it; every malformed or configuration-bearing
link is refused on stderr with a non-zero exit and no session; an untrusted directory and an
unrecorded slug are refused naming `robota trust --yes`, and nothing is trusted, cloned or written.

## Observed (2026-09-20)

Run: `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts
src/__tests__/pty/flow-2006-deep-link.ptytest.ts` against the workspace build. **Exit 0 — 3 of 3
scenarios** (6.75 s). Every check throws on mismatch.

- **S1** — the frame arriving with the prefill shows `> Summarize the README in one sentence` in the
  composer, `Prompt from an external link` on the line below it, and
  `Idle  |  flow2006  |  git: main` on the status line — the fixture repository's branch, so the
  process is no longer in `elsewhere/`. Neither `Thinking` nor `Interrupting` appears anywhere in the
  transcript: nothing was sent. One Enter re-emits exactly that text as the submitted message, and
  `git log --oneline` in the fixture still reports the single `chore: fixture` commit.
- **S2** — all nine exit 1 with the FIRST violated rule named on stderr (`provider`,
  `more than once`, the missing `v`, `version 1`, `not a command`, `absolute`, the `..` segment,
  `does not exist`, `exactly one link`) and no `Type a message` on stdout — no frame is drawn.
  Afterwards the listing of `$HOME/.robota/peers` is identical to the one taken before the run (an
  interactive session writes an entry there, so none was started) and `$HOME/.robota/settings.json`
  is byte-identical: the `/mode bypassPermissions` link changed nothing.
- **S3** — the untrusted directory exits 1 with `robota trust --yes` on stderr; `nobody/not-a-clone`
  exits 1 naming the slug with no mention of cloning. Afterwards `robota trust status` inside the
  untrusted fixture still prints `untrusted`, and the SHA-256 of `$HOME/.robota/workspace-trust.json`
  equals the digest taken before the two invocations.

## Notes

Two product defects were found by this scenario and fixed before it passed. The interactive-terminal
check ran BEFORE the link was parsed, so a headless refusal reported only that a terminal was needed
rather than what was wrong with the link; the link is now judged first. And the "one argument" rule
counted ordinary flags, so `robota open <link> --name x` was refused — it now refuses only a SECOND
`robota:` token, which is the argv shape the platforms actually append.

The arrival signal for S1 is the prefilled text itself: the empty-composer placeholder never renders
once there is text, and both `Idle` and the provenance line are already on screen one frame before
the composer is drawn. OS-level registration of the `robota://` scheme is out of scope here and is
filed as FLOW-2670; the trust decision at interactive startup is TRUST-1989, which this item
contains against by refusing any target that is not already `trusted`.
