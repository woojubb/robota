---
title: 'FLOW-2006: Launch a safe prefilled local session from a deep link'
issue: https://github.com/woojubb/robota/issues/2006
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-cli, terminal UI package, apps/agent-app
depends_on: []
---

# FLOW-2006: Launch a safe prefilled local session from a deep link

## Objective

Define a versioned `robota://open` launch intent that accepts only a prompt plus cwd or repository target,
passes through existing workspace trust, and pre-fills but never submits the prompt. Register and route the
scheme on supported desktop platforms without accepting provider, permission, plugin or tool configuration.

## Plan

- [x] TC-01: the grammar — `parseLaunchIntent` accepts the three spellings and refuses every malformed form, naming the first rule violated.
- [x] TC-02: precedence and the encode/parse round trip.
- [x] TC-03: resolution — trusted-only targets, worktree grouping, the `Contained — TRUST-1989.` label at the refusal site and in the commit body.
- [x] TC-04: the `resolveLaunchInvocation` pre-parse step and its refusals.
- [x] TC-05: prefill and the external-link notice, consumed once through the controller.
- [x] TC-06: wiring into `startCli` and the `--help` catalogue.
- [x] TC-07: `listGrants()` on the workspace trust store.
- [x] TC-08: engineering verification.
- [x] TC-09: the PTY user-execution scenario over the built CLI.

## Test Plan

Test malformed encoding, duplicates, oversize prompts, unknown/configuration fields and trust refusal.
Execute a local deep-link scenario proving deterministic prefill and zero provider calls before Enter.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

Executability was proven before drafting (2026-09-20, `user-execution-scenario-author`) against the surface as it is TODAY, with none of this item's behaviour implemented. The workspace binary `packages/agent-cli/bin/robota.cjs` runs under `process.execPath` (`--version` → `robota 3.0.0-beta.79`, exit 0). In a throwaway repository under the session scratchpad with an isolated `HOME`, `robota trust --yes` printed `Workspace trust: trusted` and wrote a `"state": "trusted"` grant into `$HOME/.robota/workspace-trust.json`; in a sibling repository left ungranted, `robota trust status` printed `Workspace trust: untrusted` and `Grant access with: robota trust --yes` — the two states Scenario 1 and Scenario 3 start from, and the literal remedy string Scenario 3 expects. The current drift symptom was reproduced at the same surface: `robota open 'robota://open?v=1&prompt=hi&provider=evil' -p "/help" --bare --no-session-persistence` printed no unknown-command error and no link diagnostic at all — its output differed from the identical run without the two `open` tokens and ended in a provider call, i.e. the link is silently swallowed rather than refused, which is exactly what Scenario 2 replaces. The PTY harness that drives Scenario 1 was exercised as it stands: `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flag-tui.ptytest.ts` passed 2/2 in 0.9 s, rendering the built CLI in a real `xterm-256color` PTY. On a host where a global `robota` shadows the workspace one (`pnpm exec which robota` resolves to `~/.volta/bin/robota` here), a human runs `node <repo>/packages/agent-cli/bin/robota.cjs` with the same arguments; the ptytest always spawns the workspace binary by path.

### Scenario 1: a v=1 link opens the trusted fixture repository with the prompt prefilled, inert and labelled, and only Enter submits it

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the affected packages are built (`pnpm build:deps`, or `pnpm --filter @robota-sdk/agent-cli build` after building its dependencies); `git` is on PATH; no live credential and no external service is required at any point in this scenario — every observable is a rendered frame or the process exit code, and none of them is a provider response. Two fixtures are created OUTSIDE the monorepo: `/tmp/flow2006-trusted` (`git init -b main`; `git config user.name Robota Scenario` and `git config user.email scenario@example.invalid`; `README.md` = `fixture`, committed as `chore: fixture`) and `/tmp/flow2006-elsewhere` (an unrelated empty directory the command is launched FROM, so the change of directory is observable). `HOME` is an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile (`writeTuiProviderSettings`: `currentProvider: anthropic`, `apiKey: pty-dummy-key`); inside `/tmp/flow2006-trusted` run `robota trust --yes` once, which prints `Workspace trust: trusted` and records the grant under that HOME. The process runs in a 100x32 `xterm-256color` PTY driven by `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` (`pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flow-2006-deep-link.ptytest.ts`), which spawns `packages/agent-cli/bin/robota.cjs` under `process.execPath`; a human runs the command below from `/tmp/flow2006-elsewhere`, reads the first frame WITHOUT typing anything, then presses Enter exactly once, then types `/exit` and Enter on `Exit the session?` (TC-09 prefill half).
- command: `robota open 'robota://open?v=1&prompt=Summarize%20the%20README%20in%20one%20sentence&cwd=/tmp/flow2006-trusted'`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=an ordinary interactive session starts whose working directory is the fixture repository `/tmp/flow2006-trusted` (or its realpath `/private/tmp/flow2006-trusted` on macOS) and NOT `/tmp/flow2006-elsewhere`; on the FIRST frame the composer already holds the decoded text `Summarize the README in one sentence` with the cursor after it, while the transcript holds no user message and no assistant activity and the status line reads `Idle` — the prompt is present and unsent; the line `Prompt from an external link` is rendered below the input and stays there while the value is unchanged; pressing Enter once sends exactly that text — it leaves the composer, appears as the submitted user message, and the external-link notice disappears; the proof that nothing reached a provider before Enter is the first frame itself — the transcript is empty and the status line reads `Idle` while the prompt sits in the composer — so no provider response is part of any observable here and the scenario neither needs nor contacts an external service; typing `/exit` and confirming exits the process with code 0.
- cleanup: exit with `/exit` (Yes) and confirm the process exited, then remove `/tmp/flow2006-trusted`, `/tmp/flow2006-elsewhere` and the isolated HOME (the trust grant lives under that HOME and goes with it); nothing under the monorepo is created, modified or trusted.
- evidence: 2026-09-20 — agent-executed in a real 100x30 `xterm-256color` PTY by `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` Scenario 1 (`pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flow-2006-deep-link.ptytest.ts` → 3 passed in 6.75 s). The frame that arrives with the prefill shows `> Summarize the README in one sentence` in the composer, `Prompt from an external link` on the line below it, and `Idle  |  flow2006  |  git: main` on the status line — the fixture repository's branch, i.e. the process is no longer in the launch directory — with neither `Thinking` nor `Interrupting` anywhere in the transcript; one Enter then re-emits exactly that text as the submitted message, and `git log --oneline` in the fixture still reports the single `chore: fixture` commit. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`

### Scenario 2: every malformed or configuration-bearing link is refused on stderr with a non-zero exit and no session

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build, the same isolated HOME and the same trusted `/tmp/flow2006-trusted` fixture as Scenario 1 (so that only the link, never the target, is what each invocation is refused for); run from `/tmp/flow2006-elsewhere` in a plain non-PTY shell with `TERM=dumb` and no provider key in the environment, capturing stdout, stderr and the exit code of each of these nine invocations in order: the command below (unknown key `provider`); `robota open 'robota://open?v=1&prompt=a&prompt=b&cwd=/tmp/flow2006-trusted'` (duplicate key); `robota open 'robota://open?prompt=hi&cwd=/tmp/flow2006-trusted'` (missing `v`); `robota open 'robota://open?v=2&prompt=hi&cwd=/tmp/flow2006-trusted'` (wrong version); `robota open 'robota://open?v=1&prompt=%2Fmode%20bypassPermissions&cwd=/tmp/flow2006-trusted'` (a prompt that is a slash command); `robota open 'robota://open?v=1&prompt=hi&cwd=relative/path'` (relative `cwd`); `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-trusted/../etc'` (a `..` segment); `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-missing'` (a directory that does not exist); and `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-trusted' extra` (a second argument after the URL); afterwards inspect the session records and the permission mode under the isolated HOME and confirm no Robota process is left running (TC-09 refusal half).
- command: `robota open 'robota://open?v=1&prompt=hi&provider=anthropic&cwd=/tmp/flow2006-trusted'`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=provider — the refusal goes to STDERR and names the offending key `provider` rather than saying only that the link is invalid, stdout is empty, no TUI frame is drawn, the process exits 1 without waiting for input, and the whole URL is discarded so the prompt it carried is nowhere applied; each of the other eight invocations likewise exits non-zero with a single stderr line naming the FIRST rule it violated — the duplicate key `prompt`, the missing `v`, the unsupported version `2`, that a link may carry a prompt but not a command (for `%2Fmode%20bypassPermissions`), that `cwd` must be absolute, that `cwd` may not contain `..`, that the named directory does not exist, and that exactly one argument may follow `open` — and after all nine the isolated HOME holds no new session record, the recorded permission mode is unchanged (the `/mode bypassPermissions` link changed nothing), and no interactive session was ever started.
- cleanup: no process is left to exit (every invocation exits on its own); remove `/tmp/flow2006-trusted`, `/tmp/flow2006-elsewhere` and the isolated HOME; nothing under the monorepo is touched.
- evidence: 2026-09-20 — agent-executed by Scenario 2 of the same ptytest, which runs the nine invocations headless (`TERM=dumb`) from the launch directory. Each exits 1 with the first violated rule named on stderr — `provider`, `more than once`, the missing `v`, `version 1`, `not a command`, `absolute`, the `..` segment, `does not exist` — and with no `Type a message` on stdout; the ninth, a second link appended to argv, exits 1 naming `exactly one link`. Afterwards the listing of `$HOME/.robota/peers` is identical to the one taken before the run (an interactive session writes an entry there, so none was started) and `$HOME/.robota/settings.json` is byte-identical, so the `/mode bypassPermissions` link changed nothing. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`

### Scenario 3: an untrusted directory and an unrecorded repository slug are both refused, naming robota trust --yes, and nothing is trusted, cloned or written

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build and the same isolated HOME as Scenario 1, including the `robota trust --yes` grant for `/tmp/flow2006-trusted` (so the store is non-empty and the refusal is about THIS target, not an unreadable store); additionally create `/tmp/flow2006-untrusted` as a git repository with one commit exactly as the trusted fixture was created but WITHOUT ever running `robota trust --yes` in it — `robota trust status` there prints `Workspace trust: untrusted` and `Grant access with: robota trust --yes`, which is the starting state; record `shasum $HOME/.robota/workspace-trust.json` before the run; then from `/tmp/flow2006-elsewhere` with `TERM=dumb` run the command below and, second, `robota open 'robota://open?v=1&prompt=hi&repo=nobody/not-a-clone'`, capturing stdout, stderr and the exit code of each; afterwards re-run `robota trust status` inside `/tmp/flow2006-untrusted` and re-take the checksum (TC-09 untrusted half).
- command: `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-untrusted'`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=robota trust --yes — the refusal is written to STDERR, names the target path `/tmp/flow2006-untrusted` and the exact remedy `robota trust --yes`, stdout is empty, no TUI frame is drawn and no session starts; the second invocation, `repo=nobody/not-a-clone`, likewise exits non-zero with a stderr line naming the slug `nobody/not-a-clone` and offering the two ways forward (open the link with `cwd=`, or run `robota` in that clone and trust it first), and it neither clones nor fetches — no network is used and `/tmp/flow2006-untrusted` gains no `.git` remote; afterwards `robota trust status` inside `/tmp/flow2006-untrusted` still prints `Workspace trust: untrusted`, and `shasum $HOME/.robota/workspace-trust.json` is byte-identical to the value recorded before the run — a refused link grants nothing and records nothing.
- cleanup: no process is left to exit; remove `/tmp/flow2006-trusted`, `/tmp/flow2006-untrusted`, `/tmp/flow2006-elsewhere` and the isolated HOME; no trust grant is left anywhere and nothing under the monorepo is touched.
- evidence: 2026-09-20 — agent-executed by Scenario 3 of the same ptytest: the untrusted-directory link exits 1 with `robota trust --yes` on stderr, and `repo=nobody/not-a-clone` exits 1 naming the slug with no mention of cloning. Afterwards `robota trust status` inside the untrusted fixture still prints `untrusted`, and the SHA-256 of `$HOME/.robota/workspace-trust.json` equals the digest taken before the two invocations — a refused link grants nothing and records nothing. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`

### [DONE-GATE-STAGE-1] — 🔴 NON-COMPLIANCE | 2026-09-20

**Status remains:** scenario drafted — no `scenario drafted → scenario written` upgrade is recorded, and
this gate's own four criteria were deliberately NOT evaluated.

**Violation:** this gate was invoked after the gate it must precede had already passed and taken its
transition. The ordering check runs before any criterion, and its input-state half fails. The paired spec
was handed to this run as `.agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`
with `status: approved`; the repository actually holds it at
`.agents/spec-docs/active/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` with
`status: in-progress`, carrying `### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20`
(`**Status upgrade:** approved → in-progress`; `checkpoint-evidence:v2` `gateImplementFirst`;
`"plan": { "outcome": "automatable", "count": 3 }`; `**Judged by:** gate.mjs mechanical evaluator`).
`gate-catalogue.md` § GATE-IMPLEMENT requires "The exact Task records a subject-bound user-execution PLAN
terminal outcome: … an applicable outcome includes the author verdict and a `DONE-GATE-STAGE-1` PASS", and
`backlog-execution.md` § Pre-implementation planning checkpoint states the same order. This Task's author
verdict is `SCENARIO DRAFTED: automatable | 3` — an applicable outcome — so a `DONE-GATE-STAGE-1` PASS was a
precondition of that GATE-IMPLEMENT PASS. This Task contains no `DONE-GATE-STAGE-1` entry of any verdict;
the GATE-IMPLEMENT evidence line for that criterion reads only "Task `## User Execution Test Scenarios`
records `SCENARIO DRAFTED: automatable | 3`", which satisfies the author-verdict half and drops the
`DONE-GATE-STAGE-1` PASS half. The gate whose output this record was supposed to authorize has already
consumed it.

**Concurrent mutation (recorded, not the verdict):** while this run was reading them, both artifacts were
rewritten by another actor. This Task oscillated between a variant whose author verdict is
`SCENARIO DRAFTED: automatable | 1` with no `### Scenario` entries and a four-item untyped `## Plan`, and
the present variant (`automatable | 3`, three scenarios, nine TC-NN Plan items); the paired spec vanished
from and reappeared in the worktree and moved `todo/` → `active/`. A verdict cannot be bound to content
that changes under it (`gate-catalogue.md` § Tree binding, issue #2213).

**Required action:** the bypass is resolved before this gate is re-run; the route is the orchestrator's
call, not the guardian's. Either rewind — withdraw the GATE-IMPLEMENT PASS and the
`approved → in-progress` / `todo/` → `active/` transition, run `DONE-GATE-STAGE-1` against the `approved`
document, then re-run GATE-IMPLEMENT against the Task that by then carries this gate's PASS — or record the
bypass as a process violation on the item and obtain the user's disposition. Quiesce the concurrent writer
first so the re-run judges a stable blob. No implementation path is modified yet (the worktree holds only
the paired Task, the paired spec, and `.agents/loop-runs/backlog-execution-orchestrator.jsonl`), so the
rewind is still cheap. This run altered no recorded gate entry, did not modify the spec, and did not run
`gate.mjs advance`.

**Judged by:** `backlog-gate-guard`, against `.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1 and
`.agents/rules/backlog-execution.md` § Done Gate / § Pre-implementation planning checkpoint.
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document
`.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `2bbf6a01686a`
(modified) · paired spec
`.agents/spec-docs/active/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob
`41120a38e986` (untracked)

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-20

**Status remains:** scenario drafted — no `scenario drafted → scenario written` upgrade is recorded, and
no `checkpoint-evidence` block is written. `backlog-execution.md` § Checkpoint evidence contract declares
`doneGateStageOne` with `"statusUpgrade": "scenario drafted → scenario written"` and
`"multiplicity": "exactly-one"`; emitting that block on a non-PASS would plant the one canonical PASS
heading the commit classifier reads. `gate.mjs judge --gate DONE-GATE-STAGE-1` was attempted and answered
`unknown gate DONE-GATE-STAGE-1; expected one of GATE-WRITE, GATE-APPROVAL, GATE-IMPLEMENT, GATE-VERIFY,
GATE-COMPLETE`, so this gate is guardian-owned end to end and the machine record is derived from the
rule-owned contract above rather than from the evaluator.

**Ordering check — PASS.** Prior gate: exempt by declaration — `gate-catalogue.md` § Prior-gate map states
"DONE-GATE-STAGE-1 has no prior gate", so the predecessor half is answered from the catalogue, not assumed.
The input-state half, which produced the previous run's NON-COMPLIANCE, now holds and was verified rather
than accepted: the paired spec is at `.agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md`
with `status: approved`; its only GATE-IMPLEMENT entry is `### [GATE-IMPLEMENT] — 🔴 WITHDRAWN | 2026-09-20`
carrying `**Status returned:** in-progress → approved`, and no `[GATE-IMPLEMENT] — ✅ PASS` survives on the
document; `.agents/spec-docs/active/` holds no FLOW-2006 document; this Task is `status: todo`;
`scan-doc-folder-status-agreement` re-run here reports `violations=0 result=PASS`; and `git status` holds
only the paired Task, the paired spec and `.agents/loop-runs/backlog-execution-orchestrator.jsonl` — no
implementation path. The gate this one must precede has not consumed this gate's output, so the four
criteria below were evaluated.

**Failed criteria:**

- **Criterion 4 — a scenario requiring live credentials or an external service states that prerequisite
  explicitly (Scenario 1):** the expected observable ends "_pressing Enter once sends exactly that text …
  after which the dummy key produces a provider authentication error, which is itself the proof that no
  provider was contacted before Enter_". A **provider authentication error is a response from the provider**:
  the request must reach the Anthropic API and be answered `401`. That is an external service, and the
  scenario never states it as a prerequisite. What it states instead is the scoped negation "_no live
  credential and no external service is required **for the prefill half** — nothing reaches a provider
  before Enter_", which is true of the half it names and silent about the half that needs the network. An
  executor who is offline, behind a proxy, or on an egress-restricted host reads "no external service is
  required", runs the scenario, and discovers the dependency as a connection or DNS failure instead of the
  expected `authentication error` — which is exactly the order the criterion forbids ("_An executor must
  learn the gate cannot run in their environment from the scenario, not from the failure_"). The repository's
  own PTY convention confirms the dependency is real and is normally avoided: `pty-driver.ts` line 106
  writes the identical `apiKey: 'pty-dummy-key'` under the comment "_Boot/slash/exit make zero model calls —
  the key is never used_", and every existing `*.ptytest.ts` keeps to boot, slash commands and exit for that
  reason. Scenario 1 is the first to press Enter on a non-slash prompt and require the call to happen.
  Two aggravating specifics, recorded because they bear on the remedy rather than on the verdict: (a) the
  scenario names `writeTuiProviderSettings`, whose hardcoded `model: 'claude-test-model'` does not exist, so
  a reached provider may answer model-not-found rather than the `authentication error` the expected
  observable pins; and (b) the clause does not prove what it claims — an authentication error **after** Enter
  shows a call was made after Enter, and is silent on whether one was made before. The actual proof of
  "nothing was sent before Enter" is already in the same expected observable and is provider-free: the first
  frame holds the decoded prompt while "_the transcript holds no user message and no assistant activity and
  the status line reads `Idle`_". The failing clause therefore buys no evidence and costs an unstated
  external-service dependency.
  **Required action:** restructure Scenario 1's post-Enter observable to a provider-free one — assert that
  the text leaves the composer, appears as the submitted user message, and that the external-link notice
  disappears (all rendered product UI, all offline-observable), and stop at that boundary; or, if a
  post-Enter provider response is genuinely wanted, drive it through the shipped `agent-provider-replay`
  fixture so the work itself ships the service. If neither is taken, the network reachability of the
  provider endpoint must be written into `prerequisites` as an explicit requirement in its own right, not
  as the scope of a negation. Do not resolve this by deleting the first-frame observations — they are the
  part of the scenario that carries the proof. Scenarios 2 and 3 are unaffected and need no change.

**Criteria met (recorded in full — a criterion skipped silently is what makes a verdict worthless):**

- **Criterion 1 — every scenario is written with exact commands or UI steps, prerequisites, an expected
  observable result, and an evidence field:** MET for all three. Scenario 1 — `command:`
  `robota open 'robota://open?v=1&prompt=Summarize%20the%20README%20in%20one%20sentence&cwd=/tmp/flow2006-trusted'`;
  prerequisites name the build, the two fixtures and their exact `git init`/commit steps, the isolated
  `HOME`, the one-time `robota trust --yes` grant, the 100x32 `xterm-256color` PTY and the human-run
  alternative; `expected observable:` is a single `visible=` clause; `evidence: pending`. Scenario 2 —
  `command:` `robota open 'robota://open?v=1&prompt=hi&provider=anthropic&cwd=/tmp/flow2006-trusted'` plus
  eight further invocations listed in order in the prerequisites, each with the rule it violates;
  `expected observable:` `exit=1; output-contains=provider`; `evidence: pending`. Scenario 3 — `command:`
  `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-untrusted'` plus the `repo=nobody/not-a-clone`
  invocation; `expected observable:` `exit=1; output-contains=robota trust --yes`; `evidence: pending`.
  `pending` is the correct Stage-1 value: the field must exist now and is filled at Stage 2.
- **Criterion 2 — every scenario carries its executability decision:** MET. All three record
  `executability: agent-executable`; no scenario claims `manual-only`, so the barrier trio
  (`automation barrier:`, `unavailable capability:`, `attempted automation:`) is **not applicable** and its
  absence is correct rather than missing. Executability is not merely asserted: the section's preamble
  records it being proven at today's surface on 2026-09-20 — `robota --version` → `robota 3.0.0-beta.79`
  exit 0, `robota trust --yes` → `Workspace trust: trusted`, `robota trust status` →
  `Workspace trust: untrusted` with `Grant access with: robota trust --yes`, and
  `flag-tui.ptytest.ts` passing 2/2 in 0.9 s against the built CLI in a real PTY. The existence of that harness was re-checked here:
  `packages/agent-ui-terminal/src/__tests__/pty/` holds `pty-driver.ts`, `isolated-home.ts`,
  `vitest.pty.config.ts` and 20 sibling `*.ptytest.ts` files.
- **Criterion 3 — canonical product-surface identity and matching invocation; the observable is not a
  build, typecheck, lint, test run, harness check, CI check, or an inspection of repository text:** MET for
  all three, with `guardian-observable-verdict=product-behavior` for each. Scenario 1 —
  `product surface: robota-tui`, `surface rationale: shipped-entrypoint=robota`, invocation begins with the
  literal `robota`, `observable type: ui-state` (permitted for TUI),
  `observable rationale: source=rendered-product-ui`, expected form `visible=…`. Scenarios 2 and 3 — `product surface: robota-cli`,
  `surface rationale: shipped-entrypoint=robota`, invocations begin with `robota`,
  `observable type: product-output` (permitted for CLI), `observable rationale: source=product-process`,
  expected form `exit=<code>; output-contains=<literal>`. Every field is single-line, appears once, and is
  non-empty. The judgement this criterion actually turns on, stated rather than assumed: Scenario 1 is
  **not** an engineering observable despite a vitest command appearing in its prerequisites. The vitest
  ptytest is the **driver that spawns the product binary in a PTY**, not the thing observed — the observed
  artifact is the rendered TUI frame, the `command:` field is the product invocation, and the scenario
  supplies the equivalent human path ("a human runs the command below from `/tmp/flow2006-elsewhere`").
  This is the repository's established shape for a TUI user-execution scenario; `provider-setup.ptytest.ts`
  describes itself in-file as "the User Execution evidence the done-gate requires". **Bound carried into
  Stage 2:** the evidence recorded there must be the captured frame and the observed session state. "The
  ptytest passed" is a test result and is never user-execution evidence (`backlog-execution.md` § Done Gate,
  authoritative statement).

**Adjudication of the three further concerns the scenario author flagged — none is a criterion violation:**

- **`exit=1` where § Decision says only "non-zero" — acceptable, and required by the field grammar.**
  `backlog-execution.md` § Scenario Design Preference Order fixes the expected form as
  `exit=<code>; output-contains=<literal>`; "non-zero" is not expressible in it, so a concrete code must be
  chosen. `1` is a member of "non-zero", so the scenario narrows the design's latitude without contradicting
  it, and narrowing is the correct direction here — § Evidence forbids rewriting an expectation to match
  what was observed, so a code pinned before implementation is a constraint the implementation must meet.
  Consequence to carry, not a defect: `resolveLaunchInvocation` must return exactly `1` for every refusal in
  TC-04, or Stage 2 fails on a promise made here.
- **Literal `/tmp/flow2006-*` fixtures with the `/private/tmp` realpath admitted — acceptable.** The
  fixtures must sit outside the monorepo (the scenario asserts nothing under the repository is created,
  modified or trusted), the prerequisites create them explicitly and the cleanup removes all three plus the
  isolated `HOME`. The realpath alternative is not vagueness: it is platform-determined and
  single-valued per platform, and it matches TC-03's own requirement that a trusted `cwd` "resolves to its
  realpath". Non-blocking observation: the paths are fixed rather than unique, so a leftover
  `/tmp/flow2006-trusted` from an aborted run would be reused — harmless, because the trust grant lives
  under the per-run isolated `HOME` and is therefore always fresh.
- **`flow-2006-deep-link.ptytest.ts` does not exist yet — acceptable, and expected at this gate.**
  Confirmed absent from `packages/agent-ui-terminal/src/__tests__/pty/`. `backlog-execution.md` § Scenario
  Design Preference Order permits a not-yet-existing environment when the agent "build[s] that environment
  as part of the backlog", and this file is exactly that: the spec's § Affected Files lists
  `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts (new)`, TC-09 owns it in
  § Completion Criteria, and the § Test Plan row for TC-09 names "Process / PTY". Stage 1 is judged before
  implementation by construction, so a declared deliverable being absent is the expected state, not a gap.
  Its scaffolding (`pty-driver.ts`, `isolated-home.ts`, `writeTuiProviderSettings`, `vitest.pty.config.ts`)
  already exists and was verified here.

**Verdict:** FAIL on criterion 4 alone. Criteria 1, 2 and 3 are met for all three scenarios and Scenarios 2
and 3 are clean; the repair is confined to the final clause of Scenario 1's expected observable and does not
touch the approved scope or design. Nothing in this run was advanced: no recorded entry was altered, the
spec was not modified, and `gate.mjs advance` was not run.

**Judged by:** `backlog-gate-guard`, against `.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1 and
`.agents/rules/backlog-execution.md` § Done Gate / § Checkpoint evidence contract (`doneGateStageOne`).
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document
`.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `b84c26a1b3c4`
(modified) · paired spec
`.agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob
`9c2a76879164` (untracked)

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-20

**Status upgrade:** scenario drafted → scenario written

Re-run after the bounded correction of the criterion-4 FAIL recorded immediately above. The repair was
confined to the named failed criterion and the approved scope and design are untouched, so this is the
independent re-judgement that route requires (`backlog-execution.md` § Validated recommendations and
bounded gate-FAIL corrections); it was judged by this guardian, not by the actor that made the edit.

**Ordering check — PASS.** Prior gate exempt by declaration: `gate-catalogue.md` § Prior-gate map states
"DONE-GATE-STAGE-1 has no prior gate". Input state re-verified this run, not carried over: the paired spec
is at `.agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` with
`status: approved`, its GATE-IMPLEMENT entry is still the single `🔴 WITHDRAWN` one and no
`[GATE-IMPLEMENT] — ✅ PASS` exists on it; `.agents/spec-docs/active/` holds no FLOW-2006 document; this
Task is `status: todo`; `git status` holds only the paired Task, the paired spec and
`.agents/loop-runs/backlog-execution-orchestrator.jsonl`, so no implementation path is dirty and nothing
this gate authorises has happened yet.

- DONE-GATE-STAGE-1 — **every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field:** MET, three of three. Each carries a single-line
  `command:` beginning with the literal `robota`, a `prerequisites:` naming the build, fixtures, isolated
  `HOME` and trust grant, an `expected observable:` in the type-correct form, a `cleanup:`, and
  `evidence: pending` — the correct Stage-1 value, filled at Stage 2. All 14 declared `scenarioKeys`
  resolved to a non-empty value for all three scenarios when the payload below was extracted from the
  section text; none was hand-transcribed.
- DONE-GATE-STAGE-1 — **every scenario carries its executability decision:** MET. All three record
  `executability: agent-executable`. No scenario claims `manual-only`, so the barrier trio
  (`automation barrier:`, `unavailable capability:`, `attempted automation:`) and `uiSteps` are **not
  applicable** — their absence is correct, and the payload below carries no `conditionalScenarioKeys` for
  the same reason. Executability is evidenced, not asserted: the section preamble records the surface being
  driven on 2026-09-20 (`robota --version` → `robota 3.0.0-beta.79` exit 0; `robota trust --yes` →
  `Workspace trust: trusted`; `flag-tui.ptytest.ts` 2/2 in 0.9 s against the built CLI in a real PTY), and
  the harness those depend on was re-confirmed present in `packages/agent-ui-terminal/src/__tests__/pty/`.
- DONE-GATE-STAGE-1 — **canonical product-surface identity and matching invocation; the observable is not
  a build, typecheck, lint, test run, harness check, CI check, or an inspection of repository text:** MET,
  three of three, `guardian-observable-verdict=product-behavior` each. Scenario 1 `robota-tui` /
  `shipped-entrypoint=robota` / `ui-state` (permitted for TUI) / `source=rendered-product-ui` / `visible=…`;
  Scenarios 2 and 3 `robota-cli` / `shipped-entrypoint=robota` / `product-output` (permitted for CLI) /
  `source=product-process` / `exit=1; output-contains=…`. The judgement this criterion turns on, stated
  rather than assumed: Scenario 1 is **not** an engineering observable despite a `vitest` command appearing
  in its prerequisites. That ptytest is the harness that **spawns the product binary in a PTY**; what is
  observed is the rendered TUI frame and the process exit code, the `command:` field is the product
  invocation, and an equivalent human path is given ("a human runs the command below from
  `/tmp/flow2006-elsewhere`"). This is the repository's established shape — `provider-setup.ptytest.ts`
  describes itself in-file as "the User Execution evidence the done-gate requires". **Bound carried into
  Stage 2:** the evidence recorded there must be the captured frame, output and exit code. "The ptytest
  passed" is a test result and is never user-execution evidence (`backlog-execution.md` § Done Gate,
  authoritative statement).
- DONE-GATE-STAGE-1 — **a scenario requiring live credentials or an external service states that
  prerequisite explicitly:** MET, and this is the criterion that failed the previous run. Scenario 1 no
  longer requires either, so there is no prerequisite left to state, and the repair was verified clause by
  clause rather than accepted: its prerequisites now read "no live credential and no external service is
  required **at any point in this scenario** — every observable is a rendered frame or the process exit
  code, and none of them is a provider response", and that claim is true of every clause of the amended
  expected observable — the working directory, the first-frame composer text, the empty transcript, the
  `Idle` status line, the `Prompt from an external link` notice, the post-Enter facts (the text leaves the
  composer, appears as the submitted user message, the notice disappears) and the `/exit` exit code 0 are
  all rendered locally or are the process's own exit status, and every one of them is observable before any
  provider response could arrive. The clause that created the unstated dependency — "the dummy key produces
  a provider authentication error" — is gone; `grep` finds "authentication error" nowhere in the scenarios
  of either half of the pair (its only occurrences in this file are inside this guardian's own FAIL entry
  above, and the spec contains none). The replacement rests the proof on the first frame itself, which is
  the logically sound form: the first frame precedes Enter, so an empty transcript there does establish
  that nothing was sent before Enter — unlike the removed clause, which could only show that something was
  sent after it. The dummy `anthropic` profile remains in the prerequisites and is correct: it is what lets
  the TUI boot with a configured provider, exactly as `pty-driver.ts` does for every existing PTY fixture.
  Scenarios 2 and 3 never needed a provider — both run with `TERM=dumb` and "no provider key in the
  environment", and both refuse before a session starts.

**Field-completeness result:** 3/3 scenarios complete; 14/14 required `scenarioKeys` present and non-empty
per scenario; 0 `conditionalScenarioKeys` required and 0 supplied; `action` selected by the declared
`actionMapping` (`automatable:robota-tui` → `command`, `automatable:robota-cli` → `command`); outcome
`automatable` and count 3 agree with the Task's `**Author verdict:** SCENARIO DRAFTED: automatable | 3`.

**Pair consistency:** the `## User Execution Test Scenarios` scenario bodies of the Task and the paired
spec were diffed in full this run and are byte-identical, so the correction landed in both halves and this
verdict binds one text rather than two.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: a v=1 link opens the trusted fixture repository with the prompt prefilled, inert and labelled, and only Enter submits it",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "robota open 'robota://open?v=1&prompt=Summarize%20the%20README%20in%20one%20sentence&cwd=/tmp/flow2006-trusted'",
      "observableType": "ui-state",
      "observable": "visible=an ordinary interactive session starts whose working directory is the fixture repository `/tmp/flow2006-trusted` (or its realpath `/private/tmp/flow2006-trusted` on macOS) and NOT `/tmp/flow2006-elsewhere`; on the FIRST frame the composer already holds the decoded text `Summarize the README in one sentence` with the cursor after it, while the transcript holds no user message and no assistant activity and the status line reads `Idle` — the prompt is present and unsent; the line `Prompt from an external link` is rendered below the input and stays there while the value is unchanged; pressing Enter once sends exactly that text — it leaves the composer, appears as the submitted user message, and the external-link notice disappears; the proof that nothing reached a provider before Enter is the first frame itself — the transcript is empty and the status line reads `Idle` while the prompt sits in the composer — so no provider response is part of any observable here and the scenario neither needs nor contacts an external service; typing `/exit` and confirming exits the process with code 0.",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the affected packages are built (`pnpm build:deps`, or `pnpm --filter @robota-sdk/agent-cli build` after building its dependencies); `git` is on PATH; no live credential and no external service is required at any point in this scenario — every observable is a rendered frame or the process exit code, and none of them is a provider response. Two fixtures are created OUTSIDE the monorepo: `/tmp/flow2006-trusted` (`git init -b main`; `git config user.name Robota Scenario` and `git config user.email scenario@example.invalid`; `README.md` = `fixture`, committed as `chore: fixture`) and `/tmp/flow2006-elsewhere` (an unrelated empty directory the command is launched FROM, so the change of directory is observable). `HOME` is an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile (`writeTuiProviderSettings`: `currentProvider: anthropic`, `apiKey: pty-dummy-key`); inside `/tmp/flow2006-trusted` run `robota trust --yes` once, which prints `Workspace trust: trusted` and records the grant under that HOME. The process runs in a 100x32 `xterm-256color` PTY driven by `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` (`pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flow-2006-deep-link.ptytest.ts`), which spawns `packages/agent-cli/bin/robota.cjs` under `process.execPath`; a human runs the command below from `/tmp/flow2006-elsewhere`, reads the first frame WITHOUT typing anything, then presses Enter exactly once, then types `/exit` and Enter on `Exit the session?` (TC-09 prefill half).",
      "action": {
        "kind": "command",
        "value": "robota open 'robota://open?v=1&prompt=Summarize%20the%20README%20in%20one%20sentence&cwd=/tmp/flow2006-trusted'"
      },
      "expectedObservable": "visible=an ordinary interactive session starts whose working directory is the fixture repository `/tmp/flow2006-trusted` (or its realpath `/private/tmp/flow2006-trusted` on macOS) and NOT `/tmp/flow2006-elsewhere`; on the FIRST frame the composer already holds the decoded text `Summarize the README in one sentence` with the cursor after it, while the transcript holds no user message and no assistant activity and the status line reads `Idle` — the prompt is present and unsent; the line `Prompt from an external link` is rendered below the input and stays there while the value is unchanged; pressing Enter once sends exactly that text — it leaves the composer, appears as the submitted user message, and the external-link notice disappears; the proof that nothing reached a provider before Enter is the first frame itself — the transcript is empty and the status line reads `Idle` while the prompt sits in the composer — so no provider response is part of any observable here and the scenario neither needs nor contacts an external service; typing `/exit` and confirming exits the process with code 0.",
      "cleanup": "exit with `/exit` (Yes) and confirm the process exited, then remove `/tmp/flow2006-trusted`, `/tmp/flow2006-elsewhere` and the isolated HOME (the trust grant lives under that HOME and goes with it); nothing under the monorepo is created, modified or trusted.",
      "evidence": "2026-09-20 — agent-executed in a real 100x30 `xterm-256color` PTY by `packages/agent-ui-terminal/src/__tests__/pty/flow-2006-deep-link.ptytest.ts` Scenario 1 (`pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/flow-2006-deep-link.ptytest.ts` → 3 passed in 6.75 s). The frame that arrives with the prefill shows `> Summarize the README in one sentence` in the composer, `Prompt from an external link` on the line below it, and `Idle  |  flow2006  |  git: main` on the status line — the fixture repository's branch, i.e. the process is no longer in the launch directory — with neither `Thinking` nor `Interrupting` anywhere in the transcript; one Enter then re-emits exactly that text as the submitted message, and `git log --oneline` in the fixture still reports the single `chore: fixture` commit. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`"
    },
    {
      "name": "Scenario 2: every malformed or configuration-bearing link is refused on stderr with a non-zero exit and no session",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "robota open 'robota://open?v=1&prompt=hi&provider=anthropic&cwd=/tmp/flow2006-trusted'",
      "observableType": "product-output",
      "observable": "exit=1; output-contains=provider — the refusal goes to STDERR and names the offending key `provider` rather than saying only that the link is invalid, stdout is empty, no TUI frame is drawn, the process exits 1 without waiting for input, and the whole URL is discarded so the prompt it carried is nowhere applied; each of the other eight invocations likewise exits non-zero with a single stderr line naming the FIRST rule it violated — the duplicate key `prompt`, the missing `v`, the unsupported version `2`, that a link may carry a prompt but not a command (for `%2Fmode%20bypassPermissions`), that `cwd` must be absolute, that `cwd` may not contain `..`, that the named directory does not exist, and that exactly one argument may follow `open` — and after all nine the isolated HOME holds no new session record, the recorded permission mode is unchanged (the `/mode bypassPermissions` link changed nothing), and no interactive session was ever started.",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the same build, the same isolated HOME and the same trusted `/tmp/flow2006-trusted` fixture as Scenario 1 (so that only the link, never the target, is what each invocation is refused for); run from `/tmp/flow2006-elsewhere` in a plain non-PTY shell with `TERM=dumb` and no provider key in the environment, capturing stdout, stderr and the exit code of each of these nine invocations in order: the command below (unknown key `provider`); `robota open 'robota://open?v=1&prompt=a&prompt=b&cwd=/tmp/flow2006-trusted'` (duplicate key); `robota open 'robota://open?prompt=hi&cwd=/tmp/flow2006-trusted'` (missing `v`); `robota open 'robota://open?v=2&prompt=hi&cwd=/tmp/flow2006-trusted'` (wrong version); `robota open 'robota://open?v=1&prompt=%2Fmode%20bypassPermissions&cwd=/tmp/flow2006-trusted'` (a prompt that is a slash command); `robota open 'robota://open?v=1&prompt=hi&cwd=relative/path'` (relative `cwd`); `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-trusted/../etc'` (a `..` segment); `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-missing'` (a directory that does not exist); and `robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-trusted' extra` (a second argument after the URL); afterwards inspect the session records and the permission mode under the isolated HOME and confirm no Robota process is left running (TC-09 refusal half).",
      "action": {
        "kind": "command",
        "value": "robota open 'robota://open?v=1&prompt=hi&provider=anthropic&cwd=/tmp/flow2006-trusted'"
      },
      "expectedObservable": "exit=1; output-contains=provider — the refusal goes to STDERR and names the offending key `provider` rather than saying only that the link is invalid, stdout is empty, no TUI frame is drawn, the process exits 1 without waiting for input, and the whole URL is discarded so the prompt it carried is nowhere applied; each of the other eight invocations likewise exits non-zero with a single stderr line naming the FIRST rule it violated — the duplicate key `prompt`, the missing `v`, the unsupported version `2`, that a link may carry a prompt but not a command (for `%2Fmode%20bypassPermissions`), that `cwd` must be absolute, that `cwd` may not contain `..`, that the named directory does not exist, and that exactly one argument may follow `open` — and after all nine the isolated HOME holds no new session record, the recorded permission mode is unchanged (the `/mode bypassPermissions` link changed nothing), and no interactive session was ever started.",
      "cleanup": "no process is left to exit (every invocation exits on its own); remove `/tmp/flow2006-trusted`, `/tmp/flow2006-elsewhere` and the isolated HOME; nothing under the monorepo is touched.",
      "evidence": "2026-09-20 — agent-executed by Scenario 2 of the same ptytest, which runs the nine invocations headless (`TERM=dumb`) from the launch directory. Each exits 1 with the first violated rule named on stderr — `provider`, `more than once`, the missing `v`, `version 1`, `not a command`, `absolute`, the `..` segment, `does not exist` — and with no `Type a message` on stdout; the ninth, a second link appended to argv, exits 1 naming `exactly one link`. Afterwards the listing of `$HOME/.robota/peers` is identical to the one taken before the run (an interactive session writes an entry there, so none was started) and `$HOME/.robota/settings.json` is byte-identical, so the `/mode bypassPermissions` link changed nothing. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`"
    },
    {
      "name": "Scenario 3: an untrusted directory and an unrecorded repository slug are both refused, naming robota trust --yes, and nothing is trusted, cloned or written",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-untrusted'",
      "observableType": "product-output",
      "observable": "exit=1; output-contains=robota trust --yes — the refusal is written to STDERR, names the target path `/tmp/flow2006-untrusted` and the exact remedy `robota trust --yes`, stdout is empty, no TUI frame is drawn and no session starts; the second invocation, `repo=nobody/not-a-clone`, likewise exits non-zero with a stderr line naming the slug `nobody/not-a-clone` and offering the two ways forward (open the link with `cwd=`, or run `robota` in that clone and trust it first), and it neither clones nor fetches — no network is used and `/tmp/flow2006-untrusted` gains no `.git` remote; afterwards `robota trust status` inside `/tmp/flow2006-untrusted` still prints `Workspace trust: untrusted`, and `shasum $HOME/.robota/workspace-trust.json` is byte-identical to the value recorded before the run — a refused link grants nothing and records nothing.",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "the same build and the same isolated HOME as Scenario 1, including the `robota trust --yes` grant for `/tmp/flow2006-trusted` (so the store is non-empty and the refusal is about THIS target, not an unreadable store); additionally create `/tmp/flow2006-untrusted` as a git repository with one commit exactly as the trusted fixture was created but WITHOUT ever running `robota trust --yes` in it — `robota trust status` there prints `Workspace trust: untrusted` and `Grant access with: robota trust --yes`, which is the starting state; record `shasum $HOME/.robota/workspace-trust.json` before the run; then from `/tmp/flow2006-elsewhere` with `TERM=dumb` run the command below and, second, `robota open 'robota://open?v=1&prompt=hi&repo=nobody/not-a-clone'`, capturing stdout, stderr and the exit code of each; afterwards re-run `robota trust status` inside `/tmp/flow2006-untrusted` and re-take the checksum (TC-09 untrusted half).",
      "action": {
        "kind": "command",
        "value": "robota open 'robota://open?v=1&prompt=hi&cwd=/tmp/flow2006-untrusted'"
      },
      "expectedObservable": "exit=1; output-contains=robota trust --yes — the refusal is written to STDERR, names the target path `/tmp/flow2006-untrusted` and the exact remedy `robota trust --yes`, stdout is empty, no TUI frame is drawn and no session starts; the second invocation, `repo=nobody/not-a-clone`, likewise exits non-zero with a stderr line naming the slug `nobody/not-a-clone` and offering the two ways forward (open the link with `cwd=`, or run `robota` in that clone and trust it first), and it neither clones nor fetches — no network is used and `/tmp/flow2006-untrusted` gains no `.git` remote; afterwards `robota trust status` inside `/tmp/flow2006-untrusted` still prints `Workspace trust: untrusted`, and `shasum $HOME/.robota/workspace-trust.json` is byte-identical to the value recorded before the run — a refused link grants nothing and records nothing.",
      "cleanup": "no process is left to exit; remove `/tmp/flow2006-trusted`, `/tmp/flow2006-untrusted`, `/tmp/flow2006-elsewhere` and the isolated HOME; no trust grant is left anywhere and nothing under the monorepo is touched.",
      "evidence": "2026-09-20 — agent-executed by Scenario 3 of the same ptytest: the untrusted-directory link exits 1 with `robota trust --yes` on stderr, and `repo=nobody/not-a-clone` exits 1 naming the slug with no mention of cloning. Afterwards `robota trust status` inside the untrusted fixture still prints `untrusted`, and the SHA-256 of `$HOME/.robota/workspace-trust.json` equals the digest taken before the two invocations — a refused link grants nothing and records nothing. — full record in `.agents/evals/scenarios/flow-2006-deep-link-agent-run.md`"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

**Judged by:** `backlog-gate-guard`, against `.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1 and
`.agents/rules/backlog-execution.md` § Done Gate / § Checkpoint evidence contract (`doneGateStageOne`,
v1 — the only declared version that carries this form). `gate.mjs judge --gate DONE-GATE-STAGE-1` was
attempted again this run and again answered `unknown gate DONE-GATE-STAGE-1`, so the machine record above
is derived from that rule-owned contract rather than from the evaluator.
**Judged at:** HEAD `05bae45cd32f` · base `origin/develop@1ef05e0ea248` · document
`.agents/tasks/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob `af09a0585d91`
(modified) · paired spec
`.agents/spec-docs/todo/FLOW-2006-launch-a-safe-prefilled-local-session-from-a-deep-link.md` blob
`673cce114bc2` (untracked)
