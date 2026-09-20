---
title: 'BEHAVIOR-2437: Deliver first-class Git status diff and commit commands'
issue: https://github.com/woojubb/robota/issues/2437
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-command, packages/agent-cli
depends_on: []
---

# BEHAVIOR-2437: Deliver first-class Git status diff and commit commands

## Objective

Retain a first-class Git command family because it provides structured, argument-safe status and diff output
plus an explicit commit confirmation boundary that raw `/shell` does not. Implement it through current command
modules without treating arbitrary arguments as shell text or staging additional files implicitly.

## Plan

- [ ] TC-01: `/git status` — porcelain-v2 parser and the single-call status execution.
- [ ] TC-02: `/git diff` — the grammar, `--end-of-options`/`--` argv discipline, revision verification.
- [ ] TC-03: `/git commit` — staged set only, CC MUST-rule subject validation, `ask` confirmation, headless cancellation.
- [ ] TC-04: the async argv git-process seam and the hook-nesting environment policy, against a real repository.
- [ ] TC-05: registration in `pack-coding` and the base list; `/status` stays unclaimed.
- [ ] TC-06: Engineering verification.
- [ ] TC-07: the PTY scenario over the built CLI.

## Test Plan

Use temporary Git repositories and injected confirmation to prove argument safety and state transitions; run
command package tests and a headless/PTY CLI scenario exercising status, diff and commit.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 4`

Executability was proven before drafting (2026-09-20, `user-execution-scenario-author`), against the surface as it is TODAY, with none of the four scenarios' behaviour implemented: the workspace binary `packages/agent-cli/bin/robota.cjs` was spawned under `process.execPath` in a 100x32 `xterm-256color` PTY with an isolated HOME holding the dummy provider profile, cwd a throwaway repository under the session scratchpad holding one commit, one staged edit (`greeting.txt`), one unstaged edit (`notes.txt`) and one untracked file (`scratch.log`). The TUI reached `Type a message or /help` and `Idle` with `git: main` in the status bar; typing `/` opened the autocomplete (which lists `/shell` and, today, no `/git`); `/git status` + Enter answered `Unknown command "/git". Type /help for help.`; `/shell git status --short` printed `?? scratch.log` from the fixture repository and the prompt redrew; `/exit` asked `Exit the session?` and Enter exited with code 0; `git log --oneline` afterwards still held exactly the one fixture commit. In the same fixture after `robota trust --yes`, print mode ran slash commands with no provider call: `robota -p "/help" --bare --no-session-persistence` printed the command list and exited 0; `robota -p "/git status" --bare --no-session-persistence` printed `Unknown command "/git".` and exited 1 — so a non-success command result is exit 1 headlessly. Every `Unknown command` line above is exactly the not-yet-implemented behaviour these scenarios replace; everything else (boot, slash dispatch, confirm dialog, exit, headless exit-code mapping) is the surface as shipped. Scenario 1 and 2 together are TC-07; Scenario 1 also observes TC-05's `/help` and `/status` clauses; Scenario 3 observes TC-03's nothing-staged branch and Scenario 4 TC-03's absent-`IUserInteraction` branch, each at the product surface rather than the scripted port. On a host where a global `robota` shadows the workspace one (`pnpm exec robota` resolves to `~/.volta/bin/robota` here), a human runs `node <repo>/packages/agent-cli/bin/robota.cjs` with the same arguments; the ptytest always spawns the workspace binary by path.

### Scenario 1: read the branch, the three status groups and each diff form through /git; /help lists it and /status stays unclaimed

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the affected packages are built (`pnpm build:deps`, or `pnpm --filter @robota-sdk/agent-cli build` after `pnpm build` of its dependencies); `git` is on PATH; no live credential and no external service — no turn is submitted to a provider, only slash commands run. A temporary repository is created OUTSIDE the monorepo (`git init -b main`; `git config user.name Robota Scenario` and `git config user.email scenario@example.invalid` so a later commit has an identity without any global config; `greeting.txt` = `hello`, `notes.txt` = `note one`, committed as `chore: initial fixture`), then `greeting.txt` is changed to `hello world` and `git add greeting.txt` (the STAGED edit), `note two` is appended to `notes.txt` (the UNSTAGED edit), and `scratch.log` is created (UNTRACKED). The Robota process runs in a 100x32 `xterm-256color` PTY whose HOME is an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile (`writeTuiProviderSettings`), driven by `packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts` (run with `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/behavior-2437-git.ptytest.ts`); a human runs the same command below from the fixture repository, waits for `Type a message or /help`, and types each slash line followed by Enter, in this order — `/help`, `/status`, `/git status`, `/git diff`, `/git diff --staged`, `/git diff -- notes.txt`, `/git diff HEAD~1`, `/git diff nosuchrev`, `/git diff --output=/tmp/x` — then `/exit` and Enter on `Exit the session?` (TC-07 read half; TC-05 `/help` and `/status` clauses)
- command: `pnpm exec robota --name git-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=`/help` prints a line beginning `/git` in the command list; `/status` answers `Unknown command "/status"` (the name is still unclaimed); `/git status` prints the branch `main` and the three groups with counts — `staged (1)` naming `greeting.txt`, `unstaged (1)` naming `notes.txt`, `untracked (1)` naming `scratch.log` — with no other path under any group; `/git diff` prints a hunk containing `+note two` and NOT `+hello world`; `/git diff --staged` prints a hunk containing `+hello world` and NOT `+note two`; `/git diff -- notes.txt` prints `+note two` and no `greeting.txt` header; `/git diff HEAD~1` prints a refusal line containing the literal `HEAD~1` (the repository has exactly one commit) and no `diff --git` header follows it; `/git diff nosuchrev` prints a refusal line containing the literal `nosuchrev` and no `diff --git` header follows it; `/git diff --output=/tmp/x` prints the usage line naming the accepted forms (`--staged`, `<rev>`, `<a>..<b>`, `-- <path>`) and no diff, and afterwards `/tmp/x` does not exist; after `/exit` the process exits with code 0 and, in the fixture repository, `git log --oneline` still lists exactly one commit and `git status --porcelain` still reports `M  greeting.txt`, ` M notes.txt` and `?? scratch.log` — the read commands changed nothing
- cleanup: exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME; nothing under the monorepo is touched
- evidence: pending

### Scenario 2: /git commit refuses a non-conventional subject, commits nothing on No, and on Yes commits exactly the staged file

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build, the same fresh fixture repository (one commit, staged `greeting.txt`, unstaged `notes.txt`, untracked `scratch.log`, local `user.name`/`user.email` set) and the same isolated-HOME PTY as Scenario 1, driven by the same ptytest; a human runs the command below from the fixture repository, waits for `Type a message or /help`, and types in this order — `/git commit add greeting` Enter (no `: ` separator, a MUST-rule violation); `/git commit feat: add greeting` Enter, then on the confirmation moves the highlight to `No` with the arrow keys and presses Enter; `/git commit "feat: add greeting"` Enter (outer quotes, to be stripped), then on the confirmation moves the highlight to `Yes` and presses Enter; then `/exit` and Enter on `Exit the session?`. After the run, outside Robota: `git log --oneline`, `git show --stat --format=%s HEAD`, `git status --porcelain` in the fixture repository (TC-07 commit half; TC-03's subject-rule, quote-stripping, refusal and confirmed-commit branches at the surface)
- command: `pnpm exec robota --name git-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=`/git commit add greeting` prints a refusal that names the missing `: ` type separator (Conventional Commits MUST rule), shows NO confirmation dialog, and `git log --oneline` still lists one commit; `/git commit feat: add greeting` shows a confirmation dialog whose text contains the message `feat: add greeting` and the staged listing `M` `greeting.txt`, and does NOT list `notes.txt` or `scratch.log`; choosing `No` prints `Commit cancelled.` and `git log --oneline` still lists exactly one commit; `/git commit "feat: add greeting"` shows the confirmation with the message rendered as `feat: add greeting` WITHOUT the surrounding quotes and the same one-file listing; choosing `Yes` prints a success line containing a 7-hex-digit short hash and `feat: add greeting`; afterwards `git log --oneline` lists exactly two commits, the newest with subject `feat: add greeting`, `git show --stat --format=%s HEAD` lists `greeting.txt` as the ONLY changed file (`1 file changed`), and `git status --porcelain` reports exactly ` M notes.txt` and `?? scratch.log` — the unstaged edit and the untracked file were not committed; after `/exit` the process exits with code 0
- cleanup: exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME; the commit made lives only in that removed repository
- evidence: pending

### Scenario 3: /git commit with nothing staged prints guidance with the unstaged and untracked counts and commits nothing

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build and isolated-HOME PTY as Scenario 1, driven by the same ptytest, over a fixture repository built the same way EXCEPT that nothing is staged: one commit (`greeting.txt`, `notes.txt`), `note two` appended to `notes.txt` (unstaged) and `scratch.log` created (untracked), so `git diff --cached --quiet` exits 0; a human runs the command below from that repository, waits for `Type a message or /help`, types `/git commit feat: nothing to commit` Enter, then `/exit` and Enter on `Exit the session?`; afterwards `git log --oneline` and `git status --porcelain` outside Robota (TC-03's nothing-staged branch at the surface; TC-07's guidance clause)
- command: `pnpm exec robota --name git-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=`/git commit feat: nothing to commit` prints a guidance message containing `Nothing is staged (1 unstaged, 1 untracked)` and naming `git add` and `/shell git add` as the way to stage, shows NO confirmation dialog, and afterwards `git log --oneline` still lists exactly one commit while `git status --porcelain` still reports ` M notes.txt` and `?? scratch.log` — no empty commit and no implicit `-a`; after `/exit` the process exits with code 0
- cleanup: exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME
- evidence: pending

### Scenario 4: headless /git commit cancels because no confirmation can be asked, exits non-zero, and commits nothing

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build and a fixture repository built exactly as in Scenario 1 (one commit, staged `greeting.txt`, unstaged `notes.txt`, untracked `scratch.log`, local identity set); `HOME` exported to an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile, `TERM=dumb`, no provider key in the environment — print mode runs a slash command without contacting a provider (proven above with `/help`); print mode requires workspace trust, so first run `robota trust --yes` in the fixture repository (it prints `Workspace trust: trusted`); then run the command below from the fixture repository, capture its exit code, and afterwards run `git log --oneline` there (TC-03's absent-`IUserInteraction` branch at the surface; § Fallback `/git commit` with no interactive renderer)
- command: `pnpm exec robota -p "/git commit feat: add greeting" --bare --no-session-persistence`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=cancelled — the printed result says the commit was cancelled because a confirmation was needed and none could be asked for, no `Yes`/`No` prompt is written, the process exits 1 (a non-success command result, the same mapping `Unknown command` takes today) without hanging, and afterwards `git log --oneline` in the fixture repository still lists exactly one commit while `git status --porcelain` still reports `M  greeting.txt` — the staged file was NOT committed
- cleanup: remove only the temporary repository and the isolated HOME (the trust grant is recorded under that HOME and goes with it); nothing under the monorepo is touched
- evidence: pending

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-20

Judged by `backlog-gate-guard` against this work item and its paired spec
`.agents/spec-docs/todo/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`
(`status: approved`, `lane: L2`). This heading is deliberately not the canonical dated-PASS form, so
`canonicalRawPassEntries` in `scripts/harness/scan-user-execution-plan-order.mjs` does not count it; the
single Stage-1 PASS record (with its `checkpoint-evidence:v1` block) is still to be written on a re-run.

**Ordering check: exempt.** `.agents/specs/gate-catalogue.md` prior-gate map: "DONE-GATE-STAGE-1 has no
prior gate". Input state verified on disk: Task `status: todo`, `## Plan` TC-01..TC-07 all `- [ ]`,
`` **Author verdict:** `SCENARIO DRAFTED: automatable | 4` ``; spec `status: approved` in
`.agents/spec-docs/todo/` (`scan-doc-folder-status-agreement.mjs` → `violations=0 result=PASS`), last
`[GATE-APPROVAL]` entry `✅ PASS | 2026-09-20`, no `[GATE-IMPLEMENT]` entry. NON-COMPLIANCE trigger not
met: `packages/agent-command/src/git/` does not exist, `default/default-command-modules.ts` registers 35
modules and none matches `git`, `git status --porcelain` lists only `.agents/` paths (this Task, the
untracked spec, the orchestrator ledger, two auto-generated lessons files), HEAD `867c7752` equals
`origin/develop`. Mechanical judge: `node scripts/harness/gate.mjs judge --gate DONE-GATE-STAGE-1 …`
refuses the gate name (`unknown gate DONE-GATE-STAGE-1; expected one of GATE-WRITE, GATE-APPROVAL,
GATE-IMPLEMENT, GATE-VERIFY, GATE-COMPLETE`), so no mechanical entry exists; the project's contract
functions were run directly instead.

**Deciding finding — criterion 1, FAIL.** The gate applies to "a backlog item under `.agents/tasks/`
that carries a `## User Execution Test Scenarios` section" (gate-catalogue § DONE-GATE-STAGE-1), and
`.agents/tasks/README.md` requires that section to hold "concrete product-surface scenarios with
prerequisites, exact command lines or UI steps, … expected observable results, cleanup/reset steps, and an
evidence field". This item's section declares 4 scenarios and writes 0: over the Task's section
`scenarioEntries()` returns 0 and `validateApplicableScenarioSection()` returns
`{"ok":false,"error":"applicable scenario section has no Scenario entries"}`. The four written scenarios
exist only in the paired spec's section. That is not a cosmetic split: the checkpoint scanner derives the
Stage-1 payload from the Task (`markdownSection(task, '## User Execution Test Scenarios')`,
`v1StageOneResult(task, …)` in `scan-user-execution-plan-order.mjs`), so a PASS record binding 4
scenarios cannot be produced from this item as it stands, and the SCREEN-2670 precedent
(`.agents/tasks/completed/SCREEN-2670-…md`) carried the scenario body in the Task byte-identical to the
spec before its Stage-1 PASS. Required instead: the Task's section carries the spec's scenario body
(author verdict through Scenario 4 `evidence: pending`) verbatim.

**Spec-side findings, recorded so the re-run has nothing else to fix** (over the spec's section,
`validateApplicableScenarioSection` → `ok: true`, 4 scenarios, numbered 1..4 in order):

1. Fields — 4 of 4 spec scenarios complete under the canonical contract, each with executability,
   product surface, surface rationale, prerequisites, command, observable type, observable rationale,
   expected observable, cleanup, `evidence: pending`, each exactly once. The PTY driver the prerequisites
   name (`packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts`) does not exist yet;
   the spec's § Affected Files lists it as new and TC-07 builds it — the build-the-environment-inside-the-
   backlog route. Its substrate exists: `pty-driver.ts` (`writeTuiProviderSettings` at line 94),
   `vitest.pty.config.ts`, and the workspace binary `packages/agent-cli/bin/robota.cjs`.
2. Executability — all four `agent-executable`; the `automation barrier:` / `unavailable capability:` /
   `attempted automation:` trio is N/A (count 0, as the contract requires for automatable). Verified, not
   taken from the author's probe: in a throwaway repository (one commit, staged `greeting.txt`) with an
   isolated `HOME`, `TERM=dumb` and no provider key, `node packages/agent-cli/bin/robota.cjs trust --yes`
   → `Workspace trust: trusted`, exit 0; `-p "/help" --bare --no-session-persistence` printed the command
   list, exit 0; `-p "/git status" --bare --no-session-persistence` → `Unknown command "/git".`, exit 1;
   `-p "/git commit feat: add greeting" --bare --no-session-persistence` → `Unknown command "/git".`,
   exit 1; `git log --oneline` afterwards still one commit. `--bare` and `--no-session-persistence` are
   parsed at `packages/agent-cli/src/utils/cli-args.ts:166,173`; `robota trust [--yes]` at
   `cli-help.ts:62`. The author's PTY probe transcript (`probe-git-tui.transcript.txt`) shows the TUI at
   `Idle | git-scenario | git: main`, `/git status` → `Unknown command "/git". Type /help for help.`,
   `/shell git status --short` printing the fixture's `M  greeting.txt` / ` M notes.txt` / `?? scratch.log`
   with `Command exited (code 0)`, and `/exit` reached.
3. Canonical surface + product behaviour — `guardian-observable-verdict=product-behavior` for each:
   - Scenario 1: `robota-tui` · `shipped-entrypoint=robota` · invocation
     `pnpm exec robota --name git-scenario` · `ui-state` · `source=rendered-product-ui` · expected
     `visible=` `/help` lists `/git`, `/status` stays `Unknown command`, `/git status` prints `main` with
     `staged (1)`/`unstaged (1)`/`untracked (1)` naming exactly the three fixture paths, each `/git diff`
     form's hunk content and refusals, `/tmp/x` not created, exit 0, fixture `git log`/
     `git status --porcelain` unchanged.
   - Scenario 2: `robota-tui` · `shipped-entrypoint=robota` · `pnpm exec robota --name git-scenario` ·
     `ui-state` · `source=rendered-product-ui` · expected `visible=` MUST-rule refusal with no dialog,
     confirmation dialog listing only `greeting.txt`, `Commit cancelled.` on No, quote-stripped subject and
     a 7-hex short hash on Yes, fixture then holds two commits and `1 file changed`.
   - Scenario 3: `robota-tui` · `shipped-entrypoint=robota` · `pnpm exec robota --name git-scenario` ·
     `ui-state` · `source=rendered-product-ui` · expected `visible=`
     `Nothing is staged (1 unstaged, 1 untracked)` guidance naming `git add` / `/shell git add`, no
     dialog, no commit.
   - Scenario 4: `robota-cli` · `shipped-entrypoint=robota` ·
     `pnpm exec robota -p "/git commit feat: add greeting" --bare --no-session-persistence` ·
     `product-output` · `source=product-process` · expected `exit=1; output-contains=cancelled`, no
     prompt written, staged file not committed.

   Every observable is the product's own rendered UI or process output; the post-run `git log` /
   `git status --porcelain` clauses read the FIXTURE repository's state (a product side effect), not this
   repository's text. None is a build, typecheck, lint, test run, harness check, CI check or repository-
   text inspection. Stage-2 note, not a Stage-1 defect: on this host `pnpm exec robota` resolves to
   `~/.volta/bin/robota`; the section already says the ptytest spawns the workspace binary by path and
   a human substitutes `node <repo>/packages/agent-cli/bin/robota.cjs`.

4. Credential / external service — each scenario states explicitly that no live credential and no
   external service are needed (slash commands only, no provider turn); Scenario 4 additionally names
   `TERM=dumb`, no provider key in the environment, and the `robota trust --yes` prerequisite. An
   executor learns this from the scenario.

Exception clause: not invoked — the scenarios are writable (they are written, in the wrong artifact).

**Verdict reason:** criterion 1 — the work item's `## User Execution Test Scenarios` section declares
`automatable | 4` and contains no written scenario; the four complete scenarios live only in the paired
spec.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-20

**Status upgrade:** scenario drafted → scenario written

Re-run by `backlog-gate-guard` after the `❌ FAIL | 2026-09-20` entry above, against this work item
and its paired spec
`.agents/spec-docs/todo/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`
(`status: approved`, `lane: L2`). This is the single canonical Stage-1 PASS record for the item; it
carries the rule-owned `doneGateStageOne` machine block, and `canonicalRawPassEntries` in
`scripts/harness/scan-user-execution-plan-order.mjs` requires exactly one such heading — no second
canonical PASS heading may be added for this gate.

**The deciding finding of the FAIL is resolved, verified at source.** The Task's
`## User Execution Test Scenarios` body (author verdict through Scenario 4 `evidence: pending`, 56
lines) and the spec's are byte-identical — sha256
`29ef5c4c0257fd61a8fc3567037957921f025f1557613014d60a149b37c7186a` for both. Over the Task's section
`scenarioEntries()` now returns 4 entries numbered 1..4 in order and
`validateApplicableScenarioSection()` returns `ok: true`; `scenarioContract(body, 'automatable')`
returns a complete contract for each of the four.

**Ordering check: exempt.** `.agents/specs/gate-catalogue.md` prior-gate map: "DONE-GATE-STAGE-1 has no
prior gate". Input state re-verified on disk at this run: Task `status: todo`, `## Plan` TC-01..TC-07
all `- [ ]`, `` **Author verdict:** `SCENARIO DRAFTED: automatable | 4` ``; spec `status: approved` in
`.agents/spec-docs/todo/`, last `[GATE-APPROVAL]` entry `✅ PASS | 2026-09-20`, no `[GATE-IMPLEMENT]`
entry. NON-COMPLIANCE trigger not met: `packages/agent-command/src/git/` does not exist,
`git status --porcelain` lists only `.agents/` paths (this Task, the untracked spec, the orchestrator
ledger, two auto-generated lessons files), HEAD `867c7752` equals `origin/develop`.

**Mechanical.** `node scripts/harness/gate.mjs judge --gate DONE-GATE-STAGE-1 …` refuses the gate name
(`unknown gate DONE-GATE-STAGE-1`), so the machine record below was derived with the project's own
contract functions: `parseCheckpointEvidenceContract` over `backlog-execution.md`,
`scenarioContract` per scenario, `tokenizeCanonicalShell(command).invocation` for each `action`,
`formatCheckpointEvidence(contract, 'doneGateStageOne', payload)` → ok, and
`parseCheckpointEvidence` over the emitted block → ok. The 14 scenario keys follow the rule's
`scenarioKeys` order with no conditional key (agent-executable, no `product-state-file`);
`outcome: automatable` binds the author count 4. `scan-user-execution-plan-order.mjs` runs only in
history and `--staged` modes, so its binding of this record is exercised at the GATE-IMPLEMENT
checkpoint commit, not here.

Per criterion (gate-catalogue § DONE-GATE-STAGE-1):

1. **Every scenario written with exact command, prerequisites, expected observable, evidence field** —
   PASS. 4 of 4 scenarios complete under the canonical contract, each with executability, product
   surface, surface rationale, prerequisites, command, observable type, observable rationale, expected
   observable, cleanup and `evidence: pending`, each exactly once and no other field line. The PTY
   driver the prerequisites name, `packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts`,
   does not exist yet; the spec's § Affected Files lists it as new and TC-07 builds it — the
   build-the-environment-inside-the-backlog route. Its substrate exists: `pty-driver.ts`
   (`writeTuiProviderSettings` at line 94), `vitest.pty.config.ts`, and the workspace binary
   `packages/agent-cli/bin/robota.cjs`.
2. **Executability decision** — PASS. All four `executability: agent-executable`; the
   `automation barrier:` / `unavailable capability:` / `attempted automation:` trio is N/A (count 0, as
   the contract requires for an automatable scenario). Verified by the guardian, not taken from the
   author's probe: in a throwaway repository (one commit, staged `greeting.txt`) with an isolated
   `HOME`, `TERM=dumb` and no provider key, `node packages/agent-cli/bin/robota.cjs trust --yes` →
   `Workspace trust: trusted`, exit 0; `-p "/help" --bare --no-session-persistence` printed the
   command list, exit 0; `-p "/git status" --bare --no-session-persistence` → `Unknown command "/git".`,
   exit 1; `-p "/git commit feat: add greeting" --bare --no-session-persistence` → the same line, exit
   1; `git log --oneline` afterwards still one commit. `--bare` and `--no-session-persistence` are
   parsed at `packages/agent-cli/src/utils/cli-args.ts:166,173`; `robota trust [--yes]` at
   `cli-help.ts:62`. The author's PTY probe transcript shows the TUI at
   `Idle | git-scenario | git: main`, `/git status` → `Unknown command "/git". Type /help for help.`,
   `/shell git status --short` printing the fixture's status with `Command exited (code 0)`, and
   `/exit` reached.
3. **Canonical surface, matching invocation, product behaviour** — PASS, with
   `guardian-observable-verdict=product-behavior` for each scenario; the exact surface, surface
   rationale, invocation, observable type, observable rationale and full expected observable are bound
   verbatim in the machine block below. Scenario 1, 2 and 3: `robota-tui` · `shipped-entrypoint=robota`
   · `pnpm exec robota --name git-scenario` · `ui-state` · `source=rendered-product-ui` · `visible=`
   observables (the `/help` listing, the `/git status` groups and counts, each `/git diff` form's hunk
   or refusal, the commit confirmation dialog and its outcome, the nothing-staged guidance). Scenario 4:
   `robota-cli` · `shipped-entrypoint=robota` ·
   `pnpm exec robota -p "/git commit feat: add greeting" --bare --no-session-persistence` ·
   `product-output` · `source=product-process` · `exit=1; output-contains=cancelled`. Every observable
   is the product's own rendered UI or process output; the post-run `git log` and
   `git status --porcelain` clauses read the FIXTURE repository's state (a product side effect), not this
   repository's text. None is a build, typecheck, lint, test run, harness check, CI check or
   repository-text inspection. Stage-2 note, not a Stage-1 defect: on this host `pnpm exec robota`
   resolves to `~/.volta/bin/robota`; the section states that the ptytest spawns the workspace binary by
   path and that a human substitutes `node <repo>/packages/agent-cli/bin/robota.cjs`, and Stage 2 must
   show its evidence came from the workspace build.
4. **Live credential / external service stated explicitly** — PASS. Each scenario states that no live
   credential and no external service are needed (slash commands only, no provider turn); Scenario 4
   additionally names `TERM=dumb`, no provider key in the environment, and the `robota trust --yes`
   prerequisite. An executor learns this from the scenario, not from a failure.

Field-completeness result: 4 of 4 scenarios complete; 0 unwritten scenarios, so the
written-is-impossible exception is not invoked.

**Verdict reason:** criterion 1 — the work item's section now carries all four declared scenarios,
complete under the canonical contract, and no criterion is unmet. `GATE VERDICT: PASS`

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: read the branch, the three status groups and each diff form through /git; /help lists it and /status stays unclaimed",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name git-scenario",
      "observableType": "ui-state",
      "observable": "visible=`/help` prints a line beginning `/git` in the command list; `/status` answers `Unknown command \"/status\"` (the name is still unclaimed); `/git status` prints the branch `main` and the three groups with counts — `staged (1)` naming `greeting.txt`, `unstaged (1)` naming `notes.txt`, `untracked (1)` naming `scratch.log` — with no other path under any group; `/git diff` prints a hunk containing `+note two` and NOT `+hello world`; `/git diff --staged` prints a hunk containing `+hello world` and NOT `+note two`; `/git diff -- notes.txt` prints `+note two` and no `greeting.txt` header; `/git diff HEAD~1` prints a refusal line containing the literal `HEAD~1` (the repository has exactly one commit) and no `diff --git` header follows it; `/git diff nosuchrev` prints a refusal line containing the literal `nosuchrev` and no `diff --git` header follows it; `/git diff --output=/tmp/x` prints the usage line naming the accepted forms (`--staged`, `<rev>`, `<a>..<b>`, `-- <path>`) and no diff, and afterwards `/tmp/x` does not exist; after `/exit` the process exits with code 0 and, in the fixture repository, `git log --oneline` still lists exactly one commit and `git status --porcelain` still reports `M  greeting.txt`, ` M notes.txt` and `?? scratch.log` — the read commands changed nothing",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the affected packages are built (`pnpm build:deps`, or `pnpm --filter @robota-sdk/agent-cli build` after `pnpm build` of its dependencies); `git` is on PATH; no live credential and no external service — no turn is submitted to a provider, only slash commands run. A temporary repository is created OUTSIDE the monorepo (`git init -b main`; `git config user.name Robota Scenario` and `git config user.email scenario@example.invalid` so a later commit has an identity without any global config; `greeting.txt` = `hello`, `notes.txt` = `note one`, committed as `chore: initial fixture`), then `greeting.txt` is changed to `hello world` and `git add greeting.txt` (the STAGED edit), `note two` is appended to `notes.txt` (the UNSTAGED edit), and `scratch.log` is created (UNTRACKED). The Robota process runs in a 100x32 `xterm-256color` PTY whose HOME is an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile (`writeTuiProviderSettings`), driven by `packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts` (run with `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/behavior-2437-git.ptytest.ts`); a human runs the same command below from the fixture repository, waits for `Type a message or /help`, and types each slash line followed by Enter, in this order — `/help`, `/status`, `/git status`, `/git diff`, `/git diff --staged`, `/git diff -- notes.txt`, `/git diff HEAD~1`, `/git diff nosuchrev`, `/git diff --output=/tmp/x` — then `/exit` and Enter on `Exit the session?` (TC-07 read half; TC-05 `/help` and `/status` clauses)",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name git-scenario"
      },
      "expectedObservable": "visible=`/help` prints a line beginning `/git` in the command list; `/status` answers `Unknown command \"/status\"` (the name is still unclaimed); `/git status` prints the branch `main` and the three groups with counts — `staged (1)` naming `greeting.txt`, `unstaged (1)` naming `notes.txt`, `untracked (1)` naming `scratch.log` — with no other path under any group; `/git diff` prints a hunk containing `+note two` and NOT `+hello world`; `/git diff --staged` prints a hunk containing `+hello world` and NOT `+note two`; `/git diff -- notes.txt` prints `+note two` and no `greeting.txt` header; `/git diff HEAD~1` prints a refusal line containing the literal `HEAD~1` (the repository has exactly one commit) and no `diff --git` header follows it; `/git diff nosuchrev` prints a refusal line containing the literal `nosuchrev` and no `diff --git` header follows it; `/git diff --output=/tmp/x` prints the usage line naming the accepted forms (`--staged`, `<rev>`, `<a>..<b>`, `-- <path>`) and no diff, and afterwards `/tmp/x` does not exist; after `/exit` the process exits with code 0 and, in the fixture repository, `git log --oneline` still lists exactly one commit and `git status --porcelain` still reports `M  greeting.txt`, ` M notes.txt` and `?? scratch.log` — the read commands changed nothing",
      "cleanup": "exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME; nothing under the monorepo is touched",
      "evidence": "pending"
    },
    {
      "name": "Scenario 2: /git commit refuses a non-conventional subject, commits nothing on No, and on Yes commits exactly the staged file",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name git-scenario",
      "observableType": "ui-state",
      "observable": "visible=`/git commit add greeting` prints a refusal that names the missing `: ` type separator (Conventional Commits MUST rule), shows NO confirmation dialog, and `git log --oneline` still lists one commit; `/git commit feat: add greeting` shows a confirmation dialog whose text contains the message `feat: add greeting` and the staged listing `M` `greeting.txt`, and does NOT list `notes.txt` or `scratch.log`; choosing `No` prints `Commit cancelled.` and `git log --oneline` still lists exactly one commit; `/git commit \"feat: add greeting\"` shows the confirmation with the message rendered as `feat: add greeting` WITHOUT the surrounding quotes and the same one-file listing; choosing `Yes` prints a success line containing a 7-hex-digit short hash and `feat: add greeting`; afterwards `git log --oneline` lists exactly two commits, the newest with subject `feat: add greeting`, `git show --stat --format=%s HEAD` lists `greeting.txt` as the ONLY changed file (`1 file changed`), and `git status --porcelain` reports exactly ` M notes.txt` and `?? scratch.log` — the unstaged edit and the untracked file were not committed; after `/exit` the process exits with code 0",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the same build, the same fresh fixture repository (one commit, staged `greeting.txt`, unstaged `notes.txt`, untracked `scratch.log`, local `user.name`/`user.email` set) and the same isolated-HOME PTY as Scenario 1, driven by the same ptytest; a human runs the command below from the fixture repository, waits for `Type a message or /help`, and types in this order — `/git commit add greeting` Enter (no `: ` separator, a MUST-rule violation); `/git commit feat: add greeting` Enter, then on the confirmation moves the highlight to `No` with the arrow keys and presses Enter; `/git commit \"feat: add greeting\"` Enter (outer quotes, to be stripped), then on the confirmation moves the highlight to `Yes` and presses Enter; then `/exit` and Enter on `Exit the session?`. After the run, outside Robota: `git log --oneline`, `git show --stat --format=%s HEAD`, `git status --porcelain` in the fixture repository (TC-07 commit half; TC-03's subject-rule, quote-stripping, refusal and confirmed-commit branches at the surface)",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name git-scenario"
      },
      "expectedObservable": "visible=`/git commit add greeting` prints a refusal that names the missing `: ` type separator (Conventional Commits MUST rule), shows NO confirmation dialog, and `git log --oneline` still lists one commit; `/git commit feat: add greeting` shows a confirmation dialog whose text contains the message `feat: add greeting` and the staged listing `M` `greeting.txt`, and does NOT list `notes.txt` or `scratch.log`; choosing `No` prints `Commit cancelled.` and `git log --oneline` still lists exactly one commit; `/git commit \"feat: add greeting\"` shows the confirmation with the message rendered as `feat: add greeting` WITHOUT the surrounding quotes and the same one-file listing; choosing `Yes` prints a success line containing a 7-hex-digit short hash and `feat: add greeting`; afterwards `git log --oneline` lists exactly two commits, the newest with subject `feat: add greeting`, `git show --stat --format=%s HEAD` lists `greeting.txt` as the ONLY changed file (`1 file changed`), and `git status --porcelain` reports exactly ` M notes.txt` and `?? scratch.log` — the unstaged edit and the untracked file were not committed; after `/exit` the process exits with code 0",
      "cleanup": "exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME; the commit made lives only in that removed repository",
      "evidence": "pending"
    },
    {
      "name": "Scenario 3: /git commit with nothing staged prints guidance with the unstaged and untracked counts and commits nothing",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name git-scenario",
      "observableType": "ui-state",
      "observable": "visible=`/git commit feat: nothing to commit` prints a guidance message containing `Nothing is staged (1 unstaged, 1 untracked)` and naming `git add` and `/shell git add` as the way to stage, shows NO confirmation dialog, and afterwards `git log --oneline` still lists exactly one commit while `git status --porcelain` still reports ` M notes.txt` and `?? scratch.log` — no empty commit and no implicit `-a`; after `/exit` the process exits with code 0",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the same build and isolated-HOME PTY as Scenario 1, driven by the same ptytest, over a fixture repository built the same way EXCEPT that nothing is staged: one commit (`greeting.txt`, `notes.txt`), `note two` appended to `notes.txt` (unstaged) and `scratch.log` created (untracked), so `git diff --cached --quiet` exits 0; a human runs the command below from that repository, waits for `Type a message or /help`, types `/git commit feat: nothing to commit` Enter, then `/exit` and Enter on `Exit the session?`; afterwards `git log --oneline` and `git status --porcelain` outside Robota (TC-03's nothing-staged branch at the surface; TC-07's guidance clause)",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name git-scenario"
      },
      "expectedObservable": "visible=`/git commit feat: nothing to commit` prints a guidance message containing `Nothing is staged (1 unstaged, 1 untracked)` and naming `git add` and `/shell git add` as the way to stage, shows NO confirmation dialog, and afterwards `git log --oneline` still lists exactly one commit while `git status --porcelain` still reports ` M notes.txt` and `?? scratch.log` — no empty commit and no implicit `-a`; after `/exit` the process exits with code 0",
      "cleanup": "exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME",
      "evidence": "pending"
    },
    {
      "name": "Scenario 4: headless /git commit cancels because no confirmation can be asked, exits non-zero, and commits nothing",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota -p \"/git commit feat: add greeting\" --bare --no-session-persistence",
      "observableType": "product-output",
      "observable": "exit=1; output-contains=cancelled — the printed result says the commit was cancelled because a confirmation was needed and none could be asked for, no `Yes`/`No` prompt is written, the process exits 1 (a non-success command result, the same mapping `Unknown command` takes today) without hanging, and afterwards `git log --oneline` in the fixture repository still lists exactly one commit while `git status --porcelain` still reports `M  greeting.txt` — the staged file was NOT committed",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the same build and a fixture repository built exactly as in Scenario 1 (one commit, staged `greeting.txt`, unstaged `notes.txt`, untracked `scratch.log`, local identity set); `HOME` exported to an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile, `TERM=dumb`, no provider key in the environment — print mode runs a slash command without contacting a provider (proven above with `/help`); print mode requires workspace trust, so first run `robota trust --yes` in the fixture repository (it prints `Workspace trust: trusted`); then run the command below from the fixture repository, capture its exit code, and afterwards run `git log --oneline` there (TC-03's absent-`IUserInteraction` branch at the surface; § Fallback `/git commit` with no interactive renderer)",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota -p \"/git commit feat: add greeting\" --bare --no-session-persistence"
      },
      "expectedObservable": "exit=1; output-contains=cancelled — the printed result says the commit was cancelled because a confirmation was needed and none could be asked for, no `Yes`/`No` prompt is written, the process exits 1 (a non-success command result, the same mapping `Unknown command` takes today) without hanging, and afterwards `git log --oneline` in the fixture repository still lists exactly one commit while `git status --porcelain` still reports `M  greeting.txt` — the staged file was NOT committed",
      "cleanup": "remove only the temporary repository and the isolated HOME (the trust grant is recorded under that HOME and goes with it); nothing under the monorepo is touched",
      "evidence": "pending"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
