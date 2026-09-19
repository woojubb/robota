---
title: 'SCREEN-1993: Search prompt history and conversation transcripts'
issue: https://github.com/woojubb/robota/issues/1993
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-interface-session, packages/agent-session, packages/agent-framework, packages/agent-cli, packages/agent-ui-terminal
depends_on: [STRUCT-012, REFACTOR-025, BEHAVIOR-2003]
---

# SCREEN-1993: Search prompt history and conversation transcripts

## Objective

Add responsive reverse search over persisted prompt history with current-session, current-project and
all-project scopes, newest-first deduplication, insert/run acceptance and exact cancel restoration. The
persisted source is a user-level append-only prompt-history file streamed newest-first, not a query over
session records (which would decode whole records and cross the workspace-trust boundary for other
projects). Keep the already-delivered complete native scrollback path as the transcript-view decision
rather than creating a second in-memory transcript copy.

## Plan

- [x] TC-01, TC-02: Prompt-history contracts (`IPromptHistoryEntry`, writer, streamed newest-first source),
      the owner-only `~/.robota/history.jsonl` file with its tail reader, and the session-side append on
      user-originated turns with its once-per-session failure notice.
- [x] TC-03, TC-04: The pure search flow (substring match with ranges, collapse-to-newest, scope cycle) and
      the reverse-search overlay with progressive results, insert/execute actions and exact draft restore
      on cancel.
- [x] TC-05, TC-06, TC-07: The `history-search` keybinding context and schema, the CLI enablement and
      project-key resolution, and the composition that injects the writer and source.
- [x] TC-09, TC-10: The PTY search scenario, and the scrollback check that records why native full
      scrollback is the transcript decision.
- [x] TC-08: Engineering verification.

## Test Plan

Create more than 100 prompts across several working directories; verify ordering, scope, deduplication,
progressive acceptance and cancellation in unit/component tests, then execute a PTY search and scrollback scenario.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: find, insert, run and cancel a prompt from stored history

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built (`packages/agent-cli/dist` newer than its `src`; the CLI bundle inlines `agent-ui-terminal`, so rebuild `@robota-sdk/agent-ui-terminal` then `@robota-sdk/agent-cli` when either changed); the driver `scratch/src/screen-1993-history-scenario.mts` (run as `pnpm --dir scratch exec tsx src/screen-1993-history-scenario.mts`, `HISTORY_SCENARIO_STRICT=1` at gate time) starts a local stub HTTP server (Node `http`, answering `POST /v1/chat/completions` with one canned assistant message `Hello from the stub provider.` — SSE chunks when the request carries `stream: true`, JSON otherwise — and recording every request), creates an isolated temporary HOME whose `~/.robota/settings.json` holds an `openai`-type provider profile (`currentProvider: stub`; `providers.stub = { type: openai, model: stub-model, apiKey: stub-key, baseURL }`) pointing at that stub plus an `onboarded` marker, creates a git-initialised temporary project directory and derives its project key as `realpath(git rev-parse --show-toplevel)` (the workspace identity's `worktreeRoot`), seeds `~/.robota/history.jsonl` with 120 JSON lines `{ at, sessionId, project, text }` spread across that project key and two other project values (`/srv/projects/other-a`, `/srv/projects/other-b`) plus one malformed line — including `deploy the canary to eu-west` (other-a), `deploy staging with helm chart v3` (current project, seeded twice), `redeploy after the deploy hook fails` (other-b), `rotate the staging secrets` (current project, unique), and the two newest entries `write the release notes for 3.1` then `tidy the changelog headings` — then spawns the command in a 100×32 xterm-256color PTY with `NO_COLOR=1` and cwd set to the project, submits `hello` and waits for the canned reply, types `first draft`, presses `ctrl+r`, types `deploy`, presses `ctrl+s` twice, presses `enter`, presses `ctrl+r`, types `rotate`, presses `ctrl+e`, clears the composer with `ctrl+u`, types `third draft: keep me byte-identical  ` (two trailing spaces), presses `ctrl+r`, types `helm`, presses `escape`; no live credential or external service is required
- command: `pnpm exec robota --name history-scenario --disable-update-check --no-session-persistence`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=after `first draft` and `ctrl+r`, an overlay lists stored prompts newest-first (`tidy the changelog headings` before `write the release notes for 3.1`) with the scope label `all` and the skipped-line count `1` (`1 unreadable line skipped`); typing `deploy` narrows the list to the prompts containing it — `deploy the canary to eu-west`, `deploy staging with helm chart v3` (listed once, its duplicate collapsed) and `redeploy after the deploy hook fails` — with `tidy the changelog headings` no longer shown and the matched `deploy` highlighted in each row; the first `ctrl+s` changes the scope label to `session` and lists none of those three; the second `ctrl+s` changes it to `project` and lists only `deploy staging with helm chart v3`; `enter` closes the overlay, the composer shows exactly `deploy staging with helm chart v3` and the stub's request count is unchanged; `ctrl+r`, `rotate`, `ctrl+e` sends the match — the stub receives a new request whose last user content equals `rotate the staging secrets` and the canned reply renders; `ctrl+r` with the composer holding `third draft: keep me byte-identical  `, typing `helm`, then `escape` closes the overlay and the composer shows `third draft: keep me byte-identical  ` byte-identically with no `helm` in it
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME, project and captured transcript directories
- evidence: recorded — strict driver run, exit 0: `ctrl+r` rendered `(reverse-i-search) scope: all · query:` with `120 matches · 1 unreadable line skipped` and the seeded prompts newest-first; `deploy` narrowed to the three deploy rows with the visible `[deploy]` highlight (`> re[deploy] after the [deploy] hook fails`) and the duplicate collapsed to one; `ctrl+s` read `scope: session` (no seeded deploy row) then `scope: project` (only `deploy staging with helm chart v3`); `enter` left the composer at `> deploy staging with helm chart v3` with the stub still at 1 request; `ctrl+r`, `rotate`, `ctrl+e` produced the stub's second request with last user content `rotate the staging secrets` and the canned reply rendered; `escape` left the composer at `> third draft: keep me byte-identical` with no `helm` — in `.agents/evals/scenarios/screen-1993-history-search-agent-run.md` (2026-09-19)

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario drafted → scenario written

Pre-implementation Stage-1 run. Ordering check: exempt (no prior gate per the catalogue); Task
`status: todo`, author verdict `SCENARIO DRAFTED: automatable | 1`, Scenario 1 `evidence: pending`, no
GATE-IMPLEMENT entry, spec `.agents/spec-docs/todo/SCREEN-1993-…` `status: approved`, zero commits beyond
`origin/develop` `295f48655`. The `### Scenario 1` body is its ten canonical field lines only; the
executability proof lives under `## Recommendation Evidence`.
`scripts/harness/user-execution-scenario-contract.mjs` → `validateApplicableScenarioSection` returns ok
and `scenarioContract(body, "automatable")` returns a complete contract; the JSON below is the
`stageOneScenarioPayload` derivation from that contract.

Per criterion: (1) exact command `pnpm exec robota --name history-scenario --disable-update-check
--no-session-persistence`, prerequisites naming the built packages, the isolated-HOME `openai`-type stub
profile, the driver `scratch/src/screen-1993-history-scenario.mts` (exists, 555 lines, gitignored via
`scratch/.gitignore`, targets `packages/agent-cli/bin/robota.cjs`), the seeded `~/.robota/history.jsonl`
fixture (120 entries + 1 malformed line, three project values), the 100×32 PTY and the exact key sequence
(`ctrl+r`, `ctrl+s`×2, `enter`, `ctrl+e`, `ctrl+u`, `escape`), an expected observable, cleanup and an
evidence field — met. (2) `executability: agent-executable` — met. (3) canonical `robota-tui` /
`shipped-entrypoint=robota` identity with an invocation beginning `pnpm exec robota`; observable type
`ui-state` / `source=rendered-product-ui`, an allowed TUI pairing; the observable is the running TUI's
rendered overlay (newest-first rows, scope label `all`→`session`→`project`, skipped-line count,
duplicate collapsed, match highlighted), the composer text after `enter`/`escape`, and the stub's
request count — product behaviour, not build/typecheck/lint/test/harness/CI or repository-text
inspection; guardian-observable-verdict=product-behavior — met. (4) credential/external-service
prerequisite stated explicitly: "no live credential or external service is required"; the stub is a Node
`http` server the driver itself starts on `127.0.0.1` (verified in the driver source, `createServer` /
`stub.listen(0, '127.0.0.1')`) — met. (5) expected observable is concrete: `visible=` names the exact
row order, scope labels, the `1 unreadable line skipped` count, the exact composer text
`deploy staging with helm chart v3` with an unchanged stub request count, a stub request whose last
user content equals `rotate the staging secrets`, and the byte-identical draft
`third draft: keep me byte-identical  ` restored on `escape` — met. Executability proof re-verified by
this guardian: `pnpm --dir scratch exec tsx src/screen-1993-history-scenario.mts` (non-strict) → exit 0;
report `exitCode: 0`, `terminal: 100x32 xterm-256color PTY`, the TUI rendered `> Type a message or /help`
(`packages/agent-ui-terminal/src/InputArea.tsx:279`) and `git: main`, `seeded.lines: 121`,
`currentProjectKey` in the `canonicalPath` form of
`packages/agent-framework/src/workspace-trust/node-host-workspace-trust.ts:145`, stub received 2
`POST /v1/chat/completions` requests, and all 11 TODO assertions unmet as the proof states (keys
currently unbound; `enter` sent `first draftdeploy`). Strict mode (`HISTORY_SCENARIO_STRICT=1`) is
the Stage-2 form. Surface preference: the shipped `robota` TUI entrypoint with a provider-free stub
fixture, the highest-preference executable surface for a TUI keybinding feature.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: find, insert, run and cancel a prompt from stored history",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name history-scenario --disable-update-check --no-session-persistence",
      "observableType": "ui-state",
      "observable": "visible=after `first draft` and `ctrl+r`, an overlay lists stored prompts newest-first (`tidy the changelog headings` before `write the release notes for 3.1`) with the scope label `all` and the skipped-line count `1` (`1 unreadable line skipped`); typing `deploy` narrows the list to the prompts containing it — `deploy the canary to eu-west`, `deploy staging with helm chart v3` (listed once, its duplicate collapsed) and `redeploy after the deploy hook fails` — with `tidy the changelog headings` no longer shown and the matched `deploy` highlighted in each row; the first `ctrl+s` changes the scope label to `session` and lists none of those three; the second `ctrl+s` changes it to `project` and lists only `deploy staging with helm chart v3`; `enter` closes the overlay, the composer shows exactly `deploy staging with helm chart v3` and the stub's request count is unchanged; `ctrl+r`, `rotate`, `ctrl+e` sends the match — the stub receives a new request whose last user content equals `rotate the staging secrets` and the canned reply renders; `ctrl+r` with the composer holding `third draft: keep me byte-identical  `, typing `helm`, then `escape` closes the overlay and the composer shows `third draft: keep me byte-identical  ` byte-identically with no `helm` in it",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "affected packages are built (`packages/agent-cli/dist` newer than its `src`; the CLI bundle inlines `agent-ui-terminal`, so rebuild `@robota-sdk/agent-ui-terminal` then `@robota-sdk/agent-cli` when either changed); the driver `scratch/src/screen-1993-history-scenario.mts` (run as `pnpm --dir scratch exec tsx src/screen-1993-history-scenario.mts`, `HISTORY_SCENARIO_STRICT=1` at gate time) starts a local stub HTTP server (Node `http`, answering `POST /v1/chat/completions` with one canned assistant message `Hello from the stub provider.` — SSE chunks when the request carries `stream: true`, JSON otherwise — and recording every request), creates an isolated temporary HOME whose `~/.robota/settings.json` holds an `openai`-type provider profile (`currentProvider: stub`; `providers.stub = { type: openai, model: stub-model, apiKey: stub-key, baseURL }`) pointing at that stub plus an `onboarded` marker, creates a git-initialised temporary project directory and derives its project key as `realpath(git rev-parse --show-toplevel)` (the workspace identity's `worktreeRoot`), seeds `~/.robota/history.jsonl` with 120 JSON lines `{ at, sessionId, project, text }` spread across that project key and two other project values (`/srv/projects/other-a`, `/srv/projects/other-b`) plus one malformed line — including `deploy the canary to eu-west` (other-a), `deploy staging with helm chart v3` (current project, seeded twice), `redeploy after the deploy hook fails` (other-b), `rotate the staging secrets` (current project, unique), and the two newest entries `write the release notes for 3.1` then `tidy the changelog headings` — then spawns the command in a 100×32 xterm-256color PTY with `NO_COLOR=1` and cwd set to the project, submits `hello` and waits for the canned reply, types `first draft`, presses `ctrl+r`, types `deploy`, presses `ctrl+s` twice, presses `enter`, presses `ctrl+r`, types `rotate`, presses `ctrl+e`, clears the composer with `ctrl+u`, types `third draft: keep me byte-identical  ` (two trailing spaces), presses `ctrl+r`, types `helm`, presses `escape`; no live credential or external service is required",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name history-scenario --disable-update-check --no-session-persistence"
      },
      "expectedObservable": "visible=after `first draft` and `ctrl+r`, an overlay lists stored prompts newest-first (`tidy the changelog headings` before `write the release notes for 3.1`) with the scope label `all` and the skipped-line count `1` (`1 unreadable line skipped`); typing `deploy` narrows the list to the prompts containing it — `deploy the canary to eu-west`, `deploy staging with helm chart v3` (listed once, its duplicate collapsed) and `redeploy after the deploy hook fails` — with `tidy the changelog headings` no longer shown and the matched `deploy` highlighted in each row; the first `ctrl+s` changes the scope label to `session` and lists none of those three; the second `ctrl+s` changes it to `project` and lists only `deploy staging with helm chart v3`; `enter` closes the overlay, the composer shows exactly `deploy staging with helm chart v3` and the stub's request count is unchanged; `ctrl+r`, `rotate`, `ctrl+e` sends the match — the stub receives a new request whose last user content equals `rotate the staging secrets` and the canned reply renders; `ctrl+r` with the composer holding `third draft: keep me byte-identical  `, typing `helm`, then `escape` closes the overlay and the composer shows `third draft: keep me byte-identical  ` byte-identically with no `helm` in it",
      "cleanup": "exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME, project and captured transcript directories",
      "evidence": "pending"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario written → scenario executed

Ordering: the last (and only) `[DONE-GATE-STAGE-1]` entry is ✅ PASS (2026-09-19), frozen with its
`doneGateStageOne` JSON in the planning checkpoint `eef2c0dda`, which is an ancestor of HEAD
`eea4c2152`; the two commits after the checkpoint on `feat/screen-1993-transcript-search` above
`origin/develop` `295f48655` are the implementation `366e5aad8` and the evidence/plan-tick commit
`eea4c2152`. Task `status: in-progress` in the root (not `done`); every `## Plan` item is ticked; no
prior Stage-2 entry. Scenario 1's `expected observable` field is byte-identical to the checkpoint's
(sha256 of the line from `git show eef2c0dda:<Task>` equals the working copy's, `386815433a…`); the only
Task changes since the checkpoint are the five Plan ticks, the `- evidence:` line, and one wording
change in `## Recommendation Evidence` (`request #2` → `the second request`), none of them scenario
fields. Build freshness: the CLI bundle `packages/agent-cli/dist/node/bin.js` (artifact `46702f65`,
15:12:28) inlines `agent-ui-terminal` (the `reverse-i-search` string is in `bin.js`; the only
`@robota-sdk/agent-ui-terminal` reference is in the source map) and was OLDER than five inlined sources
modified 15:15:44–15:15:52 (`HistorySearchOverlay.tsx`, `history-search/history-search-flow.ts`,
`interactive/session-persistence.ts`, `interactive/interactive-session-init-options.ts`,
`prompt-history-file.ts`); the `agent-ui-terminal`, `agent-framework`, `agent-session` and
`agent-interface-session` dists were already newer than their newest `src/` file, so the guardian ran
only `pnpm --filter @robota-sdk/agent-cli build` (artifact `084b50a7`, `bin.js` 15:22:38) before the
run. The guardian then re-executed the scenario itself:
`HISTORY_SCENARIO_STRICT=1 pnpm --dir scratch exec tsx src/screen-1993-history-scenario.mts` → exit 0,
report `command: node …/packages/agent-cli/bin/robota.cjs --name history-scenario --disable-update-check
--no-session-persistence` (the `robota` bin of `packages/agent-cli/package.json` is `./bin/robota.cjs`),
`terminal: 100x32 xterm-256color PTY`, `exitCode: 0`, `seeded.lines: 122` (120 + 1 malformed + the
session's own `hello` append), three project values with `currentProjectKey` equal to the temp
project's realpath, stub requests `hello` then `rotate the staging secrets` (both
`POST /v1/chat/completions`, `stream: true`), `harness.cliStarted/providerTurnCompleted/
seededHistoryFileExists: true`, all 11 strict checks `matched: true`.

- Scenario 1 — `pnpm exec robota --name history-scenario --disable-update-check
  --no-session-persistence` (100×32 xterm-256color PTY, `NO_COLOR=1`, isolated HOME with the
  `openai`-type stub profile, git-initialised temp project, seeded `~/.robota/history.jsonl`, local stub
  on 127.0.0.1): exit 0. Matched clause by clause against `expected observable` from the guardian's own
  strict run (`todo[].observed`): (a) after `first draft` + `ctrl+r` an overlay opens with scope label
  `all` — observed `│ (reverse-i-search) scope: all · query:` with the composer row `> first draft`
  still below it; (b) newest-first, `tidy the changelog headings` before `write the release notes for
  3.1` — observed stream indices `{"newest":1140,"secondNewest":1241}` and the visible rows descending
  `prompt 116 … prompt 113`; (c) skipped-line count `1` — observed
  `│ 120 matches · 1 unreadable line skipped`; (d) `deploy` narrows to the three deploy prompts with
  the newest non-match gone — observed `{"otherA":true,"current":true,"otherB":true,
  "newestNonMatchStillVisible":false}`; (e) the duplicate listed once — observed `{"occurrences":1}`;
  (f) the match highlighted in each row — observed under `NO_COLOR` as the visible marker
  `│ > re[deploy] after the [deploy] hook fails`, `│   [deploy] staging with helm chart v3`,
  `│   [deploy] the canary to eu-west`; (g) first `ctrl+s` → `session` listing none of the three —
  observed `│ (reverse-i-search) scope: session · query: deploy` with `anyDeployVisible: false`; (h)
  second `ctrl+s` → `project` listing only `deploy staging with helm chart v3` — observed
  `scope: project · query: deploy` with `{"current":true,"otherA":false,"otherB":false}`; (i) `enter`
  closes the overlay, the composer shows exactly `deploy staging with helm chart v3`, stub count
  unchanged — observed `{"composer":["> deploy staging with helm chart v3"],"overlayStillOpen":false,
  "stubRequestsBefore":1,"stubRequestsAfter":1}`; (j) `ctrl+r`, `rotate`, `ctrl+e` sends the match and
  the canned reply renders — observed stub request 2 `lastUserContent: "rotate the staging secrets"`,
  `replyRendered: true`; (k) `ctrl+r` with the draft `third draft: keep me byte-identical  `, `helm`,
  `escape` closes the overlay and restores the draft byte-identically with no `helm` — observed
  `{"composer":["> third draft: keep me byte-identical"],"overlayStillOpen":false}` and no `helm` in the
  frame. Because the caret is `chalk.inverse(' ')` (invisible under `NO_COLOR`) the stripped frame
  cannot show the two trailing spaces, so the guardian corroborated the clause from the raw PTY stream
  of a second identical run (a scratchpad copy of the driver that only dumps the unstripped cancel
  frame): the real-cursor placement after `escape` is `ESC[5A ESC[41G` — column 41 on the composer row
  ` > third draft: keep me byte-identical` (38 visible cells), i.e. 40 cells before the caret = 38
  visible + 2 trailing spaces; a dropped trailing pair would have put the caret at column 39. The draft
  is restored byte-identically in the rendered UI.
- Evidence record: `.agents/evals/scenarios/screen-1993-history-search-agent-run.md` § Observed
  (2026-09-19), committed in `eea4c2152`; its `checks[].observed` values equal the guardian's run
  verbatim (the same overlay line, indices `1140`/`1241`, the same `[deploy]` rows, the same
  `session`/`project` labels, `stubRequestsBefore/After: 1/1`, `rotate the staging secrets`,
  `> third draft: keep me byte-identical`). The `- evidence:` field cites that record and quotes product
  output only; referenced paths `.agents/evals/scenarios/screen-1993-history-search-agent-run.md`,
  `scratch/src/screen-1993-history-scenario.mts` and `packages/agent-cli/bin/robota.cjs` exist;
  `pnpm harness:scan:done-evidence` passes. No exception (`manual-only`) or capability-absence claim
  was made, so none needed a probe. The record's `### Supporting test suites` list and the ticked
  `TC-08: Engineering verification` Plan item are engineering verification and were not counted as
  user-execution evidence. Observation for the orchestrator, not a criterion of this gate: the record's
  `**Spec:**` header names `.agents/spec-docs/done/…` while the spec currently sits in
  `.agents/spec-docs/active/` with `status: in-progress`, the same pre-completion state the sibling
  SCREEN-1992 record was in at this stage.

## Recommendation Evidence

- Executability proof (PLAN mode, 2026-09-19, `user-execution-scenario-author`): the driver
  `scratch/src/screen-1993-history-scenario.mts` was run once against the CURRENT build
  (`packages/agent-cli/dist` already newer than `packages/agent-cli/src`; no rebuild needed) with
  `pnpm --dir scratch exec tsx src/screen-1993-history-scenario.mts` (non-strict) → exit 0 in well under a
  minute. Report: `command: node …/packages/agent-cli/bin/robota.cjs --name history-scenario
  --disable-update-check --no-session-persistence`, `terminal: 100x32 xterm-256color PTY`, `exitCode: 0`.
  HARNESS assertions passed: (1) the TUI started in the PTY and rendered `Type a message or /help`
  (`packages/agent-ui-terminal/src/InputArea.tsx:279`, the composer placeholder) and the status bar read
  `git: main` for the git-initialised temp project; (2) `hello` reached the stub as
  `POST /v1/chat/completions` with `stream: true` and the canned reply `Hello from the stub provider.`
  rendered; (3) the seeded `~/.robota/history.jsonl` existed with 121 lines (120 entries + 1 malformed)
  and `currentProjectKey` equalled `realpath(git rev-parse --show-toplevel)` of the project cwd
  (`/private/var/folders/…/project`, the `canonicalPath` form
  `packages/agent-framework/src/workspace-trust/node-host-workspace-trust.ts:145` produces). TODO
  assertions unmet today — all 11, as expected because `ctrl+r`, `ctrl+s`, `ctrl+e` are unbound and
  `escape` does nothing in the composer: the keys were typed into the composer as text (`enter` submitted
  `first draftdeploy` to the stub as the second request; the cancel frame read
  `> third draft: keep me byte-identical  helm`). Unmet list: overlay with scope label `all`; newest-first
  order; skipped-line count `1`; `deploy` narrowing; duplicate collapsed to one row; match highlighted;
  `ctrl+s` → `session`; `ctrl+s` → `project`; `enter` inserts without sending; `ctrl+e` sends the match;
  `escape` restores the draft byte-identically. At gate time run with `HISTORY_SCENARIO_STRICT=1` so every
  TODO check throws. Caveat for the implementer: with `NO_COLOR=1` chalk emits no SGR, so the "match
  highlighted" clause is observable only if the overlay marks the match in a way that survives
  `NO_COLOR` (the driver accepts an SGR run or a visible bracket/marker around the matched text); the
  driver's overlay-detection regexes (`scope|history` near the label, `1 unreadable lines? skipped`)
  follow the spec's Fallback wording and may be tightened to the delivered strings without changing the
  scenario's expected observable.
- `DEPTH VERDICT: LOCAL` — 2026-09-19 (`finding-depth-triager`): persisted records already carry prompt
  text, timestamp and cwd; the store port lacks only a query; the transcript half is delivered by
  SCREEN-010 native scrollback, so the issue's 100-message-window premise is stale; "all projects" has no
  enumerable source, which is a design decision, not a defect underneath.
- `PRIOR_ART_RESEARCH: FOUND` — 2026-09-19 (`prior-art-researcher`, 17 product-documentation references;
  the issue's 2026-08-22 checklist still holds upstream).
- `REVIEW VERDICT: ENDORSE` — 2026-09-19 (`proposal-reviewer`, round 2 after one REVISE round of 10
  findings, all folded into the design): a user-level append-only prompt-history file streamed
  newest-first behind `agent-interface-session` contracts, injected on the `memoryStore` precedent; the
  transcript viewer rejected on the scrollback invariant.
- Standing authorization: the session goal of 2026-09-19 — "GitHub 이슈 `#2670`의 남은 범위를 모두 구현하고,
  PR을 origin/develop에 병합한 뒤 관련 이슈를 닫아줘".
