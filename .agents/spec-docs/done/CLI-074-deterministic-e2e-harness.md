---
status: done
type: INFRA
tags: [cli, typescript]
---

# CLI-074: Deterministic E2E harness — scripted provider + PTY TUI driver (verification L2)

## Problem

The 2026-06 product verification campaign (report:
`.design/validation/agent-cli-product-verification-2026-06.md`) could not automate two
verification classes, leaving them as one-off manual/live runs:

1. **Agent-loop E2E without a real API.** Defects of the CLI-063 class ("advertised flag
   dead on one execution path") and CLI-064 class ("failure masked as success") were only
   caught by live-LLM runs. Existing tests stub either the provider per-test or the inner
   session, but there is no reusable, deterministic scripted-provider fixture that drives
   the REAL agent loop (tool calls → permission gate → session persistence → output
   contracts) in CI.
2. **TUI behavior is unverifiable by automation.** expect(1)-driven PTY smoke testing
   repeatedly collapsed typed input into bracketed paste (`[Pasted text #1 +3 lines]`) at
   both burst and ~50ms/char speeds, so slash-command execution, multi-turn flows, and the
   `/exit` shutdown-hang suspect (backlog CLI-071) cannot be confirmed or regression-locked.
   19 slash commands and the permission-approval UI have zero automated coverage.

## Architecture Review

### Affected Scope

- `packages/agent-transport` / `src/testing/` (new, exported via a `./testing` subpath) —
  `createScriptedProvider(script)`: a deterministic `IAIProvider` that replays a declared
  sequence of assistant turns (text and/or tool_use), records every request, and fails fast
  on script exhaustion
- `packages/agent-cli` / `src/__tests__/e2e/` — scripted-provider E2E suites through
  `startCli` (print mode) covering the product surface matrix: tool loop on a temp repo,
  permission plan/deny, multi-turn `-c` resume, output contracts, slash-command smoke
- `packages/agent-transport` / `src/tui/__tests__/pty/` — PTY driver tests using `node-pty`
  (devDependency, dev-only): boot, slash autocomplete, command execution, `/exit` clean
  shutdown (CLI-071 confirmation), paste-detection threshold characterization
- `packages/agent-transport/docs/SPEC.md`, `packages/agent-cli/docs/SPEC.md` — test
  strategy sections

### Alternatives Considered

1. **Scripted provider in `agent-transport/testing` + node-pty TUI driver (chosen).**
   - Pro: the scripted provider drives every REAL layer below the provider boundary (agent
     loop, tools, permissions, persistence, transports) — exactly where the verified defect
     classes lived; node-pty gives a real PTY so Ink renders identically to a terminal;
     dev-only dependency, no runtime surface.
   - Con: node-pty is a native module (build cost in CI); PTY tests need generous timeouts
     and careful flush handling.
2. **Mock at the InteractiveSession level (extend the existing per-test fakes).**
   - Pro: no new package surface; fast.
   - Con: bypasses the agent loop, permission gate, and persistence — the exact layers the
     campaign's defects lived in; cannot catch CLI-063/064-class regressions.
3. **Script-driven external harness (expect(1)/script(1) shell fixtures in CI).**
   - Pro: no native deps.
   - Con: proven flaky in this campaign (paste bundling, no clean EOF detection, ANSI
     scraping); not debuggable as unit tests; macOS/Linux behavioral drift.

### Decision

Alternative 1. The scripted provider is the missing reusable fixture for the defect classes
this campaign actually found (advertised-but-dead paths, masked failures); node-pty is the
only approach that exercises Ink's real input pipeline (the paste-detection and `/exit`
suspects are input-pipeline behaviors by definition). PTY suites run in a dedicated vitest
project with `node-pty` as a devDependency of `agent-transport` only; if native build cost
becomes a CI problem, the PTY project can be gated to a nightly job without touching the
scripted-provider suites.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 기존 테스트 픽스처 전수: per-test inline provider stubs
      (headless-skill-activation, cli-update-check, print-mode-integration 각자 중복 구현),
      mock-mcp-server(agent-tool-mcp, 재사용 가능 모델), createMockSession(framework,
      세션 레벨 우회) — 재사용 가능한 provider 레벨 공용 픽스처는 부재
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `agent-transport/src/testing/scripted-provider.ts`: `createScriptedProvider(turns)` where
   each turn declares `{ text }` or `{ toolCalls: [{name, args}] }`; returns
   `{ provider, requests }` — `requests` records every `chat()` message array for
   assertions. Script exhaustion throws (no silent fallback). Exported via package subpath
   `@robota-sdk/agent-transport/testing` (dev-facing, documented as test-only).
2. agent-cli E2E suites (print mode through `startCli`, temp cwd + isolated HOME pattern
   from `cli-exit-codes.test.ts`): tool loop (scripted Read→Edit→Bash turns against a temp
   repo, assert file mutations), permission matrix (plan blocks Edit; deniedTools blocks),
   multi-turn `-c` resume with context assertion, output contracts (text/json/stream-json/
   bare envelope shapes), slash-command smoke (each registered command returns a result
   envelope, no throw).
3. PTY driver (`node-pty` devDependency in agent-transport): helper
   `spawnTui({cols, rows, env})` returning typed `sendKeys(text, {perKeyDelayMs})`,
   `waitFor(pattern, timeout)`, `snapshot()` (ANSI-stripped), `expectExit(timeout)`.
   Suites: boot renders welcome + status bar; `/` opens autocomplete; `/help` executes
   (not paste-bundled) at human key rates; `/exit` reaches process exit within 10s —
   confirming or refuting backlog CLI-071; paste-detection characterization documents the
   burst threshold.
4. SPEC test-strategy sections updated in both packages.

## Affected Files

- `packages/agent-transport/src/testing/scripted-provider.ts` (new)
- `packages/agent-transport/src/testing/index.ts` (new) + `package.json` exports map
- `packages/agent-transport/src/tui/__tests__/pty/` (new suites + helper)
- `packages/agent-transport/package.json` (node-pty devDependency)
- `packages/agent-transport/docs/SPEC.md`
- `packages/agent-cli/src/__tests__/e2e/` (new suites)
- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `createScriptedProvider` replays declared turns in order, records request
      message arrays, and throws on script exhaustion (unit)
- [x] TC-02: tool-loop E2E — scripted tool_use turns drive real Read/Edit/Bash on a temp
      repo through print mode; the file mutation and final response are asserted; exit 0
- [x] TC-03: permission E2E — same script under `--dry-run` leaves the file untouched and
      under `--denied-tools Edit` the Edit call is denied (deny surfaced in the tool result)
- [x] TC-04: resume E2E — turn 1 then `-c` turn 2: the scripted provider's second-run
      request contains turn-1 messages; exactly one session file
- [x] TC-05: output-contract E2E — one scripted run each for text/json/stream-json/--bare
      asserting the documented envelope shapes and exit codes
- [x] TC-06: slash-command smoke — every command listed by the registry executes through
      print mode returning a result envelope (no throw, no model call needed or scripted)
- [x] TC-07: PTY — TUI boots to the prompt, `/` renders the autocomplete dropdown, `/help`
      executes as a command (not paste-bundled) at ≥30ms/key rate
- [x] TC-08: PTY — `/exit` reaches process exit within 10s (CLI-071 confirmed fixed or the
      hang reproduced and recorded in the CLI-071 backlog with the captured state)
- [x] TC-09: both SPEC.md test-strategy sections document the harness and its boundaries
      (testing subpath is dev-only; PTY suite isolation)

## Test Plan

Derived strategy (INFRA + cli): the harness IS the test infrastructure; each TC is a vitest
suite (PTY TCs in a dedicated vitest project).

| TC-ID | Test Type   | Tool / Approach                             | Notes                                      | Test reference / skip reason                                                                                                                                                                                                        |
| ----- | ----------- | ------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest — scripted provider behavior         |                                            | `packages/agent-transport/src/testing/__tests__/scripted-provider.test.ts` > `createScriptedProvider (CLI-074)` > 3 `TC-01:` tests (replay order/records requests, tool_use turns, throws on exhaustion)                            |
| TC-02 | integration | vitest — startCli print mode + temp repo    |                                            | `packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts` > `scripted agent-loop E2E (CLI-074)` > `TC-02: scripted Read→Edit→Bash turns mutate a real file through print mode`                                                    |
| TC-03 | integration | vitest — permission matrix variants         |                                            | same file > `TC-03: --dry-run blocks the Edit and leaves the file untouched` + `TC-03: --denied-tools Edit surfaces the denial in the tool result`                                                                                  |
| TC-04 | integration | vitest — two startCli runs, shared store    |                                            | same file > `TC-04: -c resume feeds the prior conversation into the next scripted request`                                                                                                                                          |
| TC-05 | integration | vitest — envelope shape assertions          |                                            | same file > `TC-05: output contracts — text, json, stream-json, --bare`                                                                                                                                                             |
| TC-06 | integration | vitest — registry-driven command sweep      |                                            | `packages/agent-cli/src/__tests__/e2e/slash-smoke.test.ts` > `slash-command smoke through print mode (CLI-074 TC-06)` > `TC-06: every command listed by /help executes to a valid json envelope`                                    |
| TC-07 | integration | vitest + node-pty — real PTY input pipeline | dedicated vitest project, generous timeout | `packages/agent-transport/src/tui/__tests__/pty/tui-pty.ptytest.ts` > `TUI through a real PTY (CLI-074)` > `TC-07: boots, opens slash autocomplete, and executes /help as a command`                                                |
| TC-08 | integration | vitest + node-pty — shutdown deadline       | CLI-071 confirmation                       | same file > `TC-08: /exit reaches process exit within 10s`                                                                                                                                                                          |
| TC-09 | manual      | SPEC.md diff review                         | doc change — reviewed in PR diff           | Test skipped: doc-only change — automated test not applicable; verified by SPEC section inspection (transport SPEC `## Test Harness Contracts (CLI-074)`, cli SPEC `## Test Strategy` deterministic-E2E paragraph) and PR #703 diff |

## Tasks

- [x] `.agents/tasks/completed/CLI-074.md` — archived at GATE-COMPLETE (T1~T10 all complete, TC-01~TC-09 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-12

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: INFRA` (valid 11-prefix value); `tags: [cli, typescript]` present
- Problem: concrete symptoms present (CLI-063/064 defect classes, expect(1) paste-bundling output `[Pasted text #1 +3 lines]`); reproduction conditions present (live-LLM-only detection in CI, PTY typing at burst and ~50ms/char); no TBD/TODO or vague single-sentence descriptions
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (per-test inline provider stubs, mock-mcp-server, createMockSession enumerated); 3 alternatives each with pro/con; Decision references the driving trade-offs (real-layer coverage of verified defect classes vs. native build cost, with nightly-gating mitigation)
- Completion Criteria: 9 items, all TC-N prefixed (TC-01–TC-09); ≥1 criterion per sub-item (scripted provider, tool loop, permissions, resume, output contracts, slash commands, PTY input, PTY shutdown, SPEC docs); all use Command/Observable form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found
- Test Plan: section present; 9 rows match 9 TC-N entries (count 9 = 9); every row has non-empty Test Type and Tool/Approach, no "TBD"; sole manual row (TC-09) has non-empty Notes explaining why ("doc change — reviewed in PR diff")
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in body

### [GATE-APPROVAL] — ❌ FAIL | 2026-06-12

**Status remains:** review-ready
**Failed criteria:**

- Explicit approval in current conversation: user reply was "머지하고 CLI-064 진행해줘" — it contains no approval token ("승인", "진행해" directed at this design) for CLI-074 and names a different item ID (CLI-064)
  **Required action:** none beyond the next criterion's action — this criterion is evaluated jointly with directedness below
- Direct, unambiguous statement directed at this spec document: the statement is directed at "CLI-064", not CLI-074. The skill explicitly excludes "Approval of a different item in the same conversation." The agent's typo hypothesis (CLI-064 already done/merged via PR #698, CLI-074 the only pending approval) is contextually plausible, but agent-side reinterpretation does not make the user's statement unambiguous; the user's non-correction after the agent announced the interpretation is "silence or lack of objection," which the skill states does NOT count as approval. The reply also did not address the offered scope options (e.g., PTY 제외 여부), so it does not "clearly confirm the design."
  **Required action:** Ask the user to explicitly confirm: "CLI-074 (scripted provider + node-pty PTY driver) 설계를 승인하시나요? (CLI-064는 PR #698로 이미 완료됨)" — re-run GATE-APPROVAL only after an unambiguous approval naming or clearly referring to CLI-074, including any scope adjustment.
- No Architecture Review or frontmatter modification after approval: N/A — no valid approval exists to anchor this check (no modifications observed since GATE-WRITE in any case).

Note: not NON-COMPLIANCE — no CLI-074 implementation work (file edits/commits) was started before this gate ran; PR #701 is a develop→main release merge unrelated to CLI-074 implementation.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-12

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: after the prior FAIL's required action was executed, the agent asked a direct structured question (AskUserQuestion, 2026-06-12) clarifying that CLI-064 was already merged (PR #698) and that the pending approval item is CLI-074, with four options (CLI-074 전체 진행 / scripted provider만 / 보류 / 다른 의미였음). The user selected: **"CLI-074 전체 진행 (Recommended)"** — an affirmative selection authorizing implementation, given after the spec was authored and summarized.
- Direct, unambiguous statement directed at this spec document: the selected option explicitly names CLI-074 and resolves the offered scope choice (full scope: scripted provider fixture + node-pty TUI driver). It is not a clarifying-answer-only reply, not silence, and not approval of a different item — the CLI-064/074 ambiguity that caused the prior FAIL was surfaced in the question itself and resolved by the selection.
- No Architecture Review or frontmatter type/tags modified after approval: `git diff HEAD` on this file shows the only change since the GATE-WRITE commit (492d81263) is the prior GATE-APPROVAL FAIL Evidence Log entry; frontmatter (`status: review-ready`, `type: INFRA`, `tags: [cli, typescript]`) and Architecture Review section are untouched.
- NON-COMPLIANCE check: no implementation artifacts exist — `.agents/tasks/CLI-074.md`, `packages/agent-transport/src/testing/`, `packages/agent-cli/src/__tests__/e2e/`, `packages/agent-transport/src/tui/__tests__/pty/` all absent; no implementation started before this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-12

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-074.md` exists (verified via filesystem; present as untracked file in `git status` on branch `feat/cli-074-e2e-harness`)
- Tasks file path recorded in `## Tasks` section: spec `## Tasks` contains `- [x] .agents/tasks/CLI-074.md — 생성 완료 (T1~T10, TC-01~TC-09 매핑)` — path matches the actual file
- Tasks correspond to Completion Criteria (≥1 task per TC-N): T1→TC-01, T2→TC-02, T3→TC-03, T4→TC-04, T5→TC-05, T6→TC-06, T7→TC-07, T8→TC-08, T9→TC-09 — all 9 TC-Ns covered, each task body matches its TC's scope; T10 is a wrap-up task (build/typecheck/lint/test, PR, evidence recording) with no TC mapping required
- NON-COMPLIANCE check: no implementation commits exist — `git diff develop...HEAD --stat` is empty (branch has no commits ahead of develop); working tree contains only the spec stage move (`backlog/ → todo/`) and the tasks file; `packages/agent-transport/src/testing/`, `packages/agent-cli/src/__tests__/e2e/`, `packages/agent-transport/src/tui/__tests__/pty/` all absent; `@homebridge/node-pty-prebuilt-multiarch` devDependency in `packages/agent-transport/package.json` is pre-existing in develop (verified via `git show develop:packages/agent-transport/package.json`), not CLI-074 implementation work

Tasks created (from `.agents/tasks/CLI-074.md`): T1 scripted provider unit (TC-01) · T2 tool-loop E2E (TC-02) · T3 permission E2E (TC-03) · T4 resume E2E (TC-04) · T5 output-contract E2E (TC-05) · T6 slash-command smoke (TC-06) · T7 PTY driver helper + boot/autocomplete/`/help` (TC-07) · T8 PTY `/exit` shutdown deadline (TC-08) · T9 SPEC sync (TC-09) · T10 verification + PR + evidence wrap-up

### [GATE-VERIFY] — ❌ FAIL | 2026-06-12

**Status remains:** in-progress
**Failed criteria:**

- All tasks in `.agents/tasks/CLI-074.md` marked complete: T1–T9 are `[x]`, but **T10 is unchecked (`[ ] T10: build/typecheck/lint/test green; PR to develop; backlog/L2 evidence recording`)** — the gate requires every task `[x]`
  **Required action:** Confirm T10's remaining substance (verification runs are green per evidence below; PR #703 to develop is OPEN; evidence-recording substance must be confirmed by the implementer), mark T10 `[x]` in `.agents/tasks/CLI-074.md`, then re-run GATE-VERIFY
- No tasks blocked or pending: T10 is pending (same finding as above)

Evidence for the remaining criteria (all met — recorded so the re-run only needs to confirm the tasks file):

- Build: `pnpm --filter "@robota-sdk/agent-cli..." build` (agent-cli + all workspace deps incl. agent-transport) — "Build complete", exit 0
- Tests (targeted): scripted-provider unit 4/4 passed (`src/testing/__tests__/scripted-provider.test.ts`); agent-cli E2E `scripted-e2e.test.ts` 5/5 + `slash-smoke.test.ts` 1/1 passed
- Tests (full affected packages): `pnpm --filter @robota-sdk/agent-transport test -- --run` → 59 files / 467 tests passed; `pnpm --filter @robota-sdk/agent-cli test -- --run` → 16 files / 134 tests passed
- PTY project: `pnpm --filter @robota-sdk/agent-transport test:pty` → 2/2 passed (TC-07 boot/autocomplete//help-as-command 840ms; TC-08 /exit exit within 10s, 1246ms)
- SPEC sections present: `packages/agent-transport/docs/SPEC.md` line 283 "## Test Harness Contracts (CLI-074)"; `packages/agent-cli/docs/SPEC.md` Test Strategy references the scripted provider from `@robota-sdk/agent-transport/testing` (line 1632)
- PR #703 `feat/cli-074-e2e-harness` → `develop` is OPEN (gh pr view 703); branch carries 2 commits (a56eb1c14 T1, 87c22bd79 T2–T9)

### [GATE-VERIFY] — ✅ PASS | 2026-06-12

**Status upgrade:** in-progress → verifying

- All tasks in `.agents/tasks/CLI-074.md` marked complete: T1–T10 all `[x]` (verified firsthand; the prior FAIL's sole failing criterion — T10 unchecked — is resolved)
- No tasks blocked or pending: none — T10's substance confirmed firsthand: (a) PR #703 `feat/cli-074-e2e-harness` → `develop` is OPEN (`gh pr view 703`); (b) L2 evidence recorded — `.design/validation/agent-cli-product-verification-2026-06.md` line 42 carries the "L2 추가 (2026-06-12, CLI-074 / PR #703)" addendum documenting the harness closing the L2 gap and PTY TC-08 refuting the CLI-071 hang; (c) CLI-071 closed — `.agents/backlog/completed/CLI-071-tui-exit-shutdown-hang.md` exists with a dated User Execution evidence block (TC-08 `/exit` exit 0 in ~1.25s; original hang shown to be an expect(1) paste-bundling artifact), committed in 87c22bd79; (d) all committed and pushed — wrap-up commit 2d10d855f (docs-only: spec doc, tasks file, validation report), branch in sync with `origin/feat/cli-074-e2e-harness`
- Build passes (`pnpm build` for affected packages): relies on the prior GATE-VERIFY run's firsthand evidence (entry above: `pnpm --filter "@robota-sdk/agent-cli..." build` → "Build complete", exit 0) — still valid because the only commit since (2d10d855f) touches docs/spec/tasks files only, no package sources
- Tests pass (`pnpm test` for affected packages): same basis — agent-transport 59 files / 467 tests passed, agent-cli 16 files / 134 tests passed, PTY project 2/2 passed (TC-07, TC-08), scripted-provider unit 4/4 passed; no source changes since
- Note: PR #703 CI checks re-triggered by the docs-only push were IN_PROGRESS at check time (build, security audit); not a gate criterion — gate build/test criteria are satisfied by the local runs above

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-12

- Command: `pnpm --filter @robota-sdk/agent-transport test -- --run src/testing/__tests__/scripted-provider.test.ts`
- Output: `Test Files 1 passed (1)`, `Tests 4 passed (4)` — `createScriptedProvider (CLI-074)` suite: replays text turns in order and records requests; replays tool_use turns as assistant toolCalls; throws on script exhaustion instead of improvising; supportsTools/validateConfig prerequisites. Exit code 0.
- Test reference: `packages/agent-transport/src/testing/__tests__/scripted-provider.test.ts` > `createScriptedProvider (CLI-074)` > three `TC-01:` tests

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-12

- Command: `pnpm --filter @robota-sdk/agent-cli test -- --run src/__tests__/e2e/scripted-e2e.test.ts src/__tests__/e2e/slash-smoke.test.ts`
- Output: `scripted-e2e.test.ts (5 tests)` passed, including `TC-02: scripted Read→Edit→Bash turns mutate a real file through print mode` — file mutation + final response + exit 0 asserted in-test. Run exit code 0.
- Test reference: `packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts` > `scripted agent-loop E2E (CLI-074)` > `TC-02: ...`

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-12

- Command: same run as TC-02 (scripted-e2e.test.ts, 5/5 passed, exit 0)
- Output: both permission variants passed — `TC-03: --dry-run blocks the Edit and leaves the file untouched` and `TC-03: --denied-tools Edit surfaces the denial in the tool result` (denial asserted via `/denied|permission|not allowed/` on tool result content)
- Test reference: same file > two `TC-03:` tests

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-12

- Command: same run as TC-02 (scripted-e2e.test.ts, 5/5 passed, exit 0)
- Output: `TC-04: -c resume feeds the prior conversation into the next scripted request` passed — second-run request contains turn-1 messages, single session file asserted
- Test reference: same file > `TC-04: ...`

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-12

- Command: same run as TC-02 (scripted-e2e.test.ts, 5/5 passed, exit 0)
- Output: `TC-05: output contracts — text, json, stream-json, --bare` passed — envelope shapes and exit codes asserted for all four output modes
- Test reference: same file > `TC-05: ...`

### [GATE-COMPLETE: TC-06] — ✅ | 2026-06-12

- Command: same run as TC-02 (slash-smoke.test.ts 1/1 passed, exit 0)
- Output: `TC-06: every command listed by /help executes to a valid json envelope` passed — registry-driven sweep, each command returns a result envelope with no throw
- Test reference: `packages/agent-cli/src/__tests__/e2e/slash-smoke.test.ts` > `slash-command smoke through print mode (CLI-074 TC-06)` > `TC-06: ...`

### [GATE-COMPLETE: TC-07] — ✅ | 2026-06-12

- Command: `pnpm --filter @robota-sdk/agent-transport test:pty`
- Output: `TC-07: boots, opens slash autocomplete, and executes /help as a command` passed (837ms) — real PTY via node-pty, dedicated vitest project (`vitest.pty.config.ts`), `/help` executed as a command (not paste-bundled) at the ≥30ms/key rate. Run exit code 0.
- Test reference: `packages/agent-transport/src/tui/__tests__/pty/tui-pty.ptytest.ts` > `TUI through a real PTY (CLI-074)` > `TC-07: ...`

### [GATE-COMPLETE: TC-08] — ✅ | 2026-06-12

- Command: same run as TC-07 (`pnpm --filter @robota-sdk/agent-transport test:pty`, 2/2 passed, exit 0)
- Output: `TC-08: /exit reaches process exit within 10s` passed (1244ms) — outcome is the criterion's first branch: CLI-071 refuted/confirmed fixed (`/exit` exits cleanly in ~1.25s; the original "hang" was an expect(1) paste-bundling artifact). Recorded: `.agents/backlog/completed/CLI-071-tui-exit-shutdown-hang.md` exists with the dated User Execution evidence block (verified on disk).
- Test reference: same file > `TC-08: ...`

### [GATE-COMPLETE: TC-09] — ✅ | 2026-06-12

- Action: SPEC section inspection (manual per Test Plan; skip reason recorded — doc-only change, no automated test applicable)
- Observed: `packages/agent-transport/docs/SPEC.md` contains `## Test Harness Contracts (CLI-074)` (line 283) documenting the scripted provider fixture as a dev-only `@robota-sdk/agent-transport/testing` subpath and the PTY project isolation (runs against the built binary, dedicated project); `packages/agent-cli/docs/SPEC.md` `## Test Strategy` (line 1627) documents the deterministic E2E suites in `src/__tests__/e2e/` driving `startCli` with the scripted provider and defers PTY coverage to the transport SPEC's harness contracts. Both sections present in PR #703.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-12

**Status upgrade:** verifying → done

- All TC-N checkboxes checked: TC-01..TC-09 all `[x]` in `## Completion Criteria` (checked by this guard after firsthand verification above)
- One `[GATE-COMPLETE: TC-N]` evidence entry per TC-N: 9 entries above, each with command/action, observed output, and exit code where applicable — all from fresh re-runs on 2026-06-12 (scripted-provider 4/4, agent-cli e2e 6/6, PTY 2/2)
- Test Plan updated: every TC row carries a test reference (TC-01..TC-08, file > describe > test name) or an explicit skip reason (TC-09 manual, doc-only); no TC silently unaddressed
- Tasks file archived: `.agents/tasks/CLI-074.md` → `.agents/tasks/completed/CLI-074.md` (`git mv`, verified on disk); all T1–T10 `[x]` at archive time
- `## Tasks` section updated to the archived path
- Prior-gate evidence intact: GATE-WRITE/APPROVAL/IMPLEMENT/VERIFY PASS entries present and well-formed — no NON-COMPLIANCE condition
