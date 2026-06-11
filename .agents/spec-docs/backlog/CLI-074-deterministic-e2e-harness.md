---
status: review-ready
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

- [ ] TC-01: `createScriptedProvider` replays declared turns in order, records request
      message arrays, and throws on script exhaustion (unit)
- [ ] TC-02: tool-loop E2E — scripted tool_use turns drive real Read/Edit/Bash on a temp
      repo through print mode; the file mutation and final response are asserted; exit 0
- [ ] TC-03: permission E2E — same script under `--dry-run` leaves the file untouched and
      under `--denied-tools Edit` the Edit call is denied (deny surfaced in the tool result)
- [ ] TC-04: resume E2E — turn 1 then `-c` turn 2: the scripted provider's second-run
      request contains turn-1 messages; exactly one session file
- [ ] TC-05: output-contract E2E — one scripted run each for text/json/stream-json/--bare
      asserting the documented envelope shapes and exit codes
- [ ] TC-06: slash-command smoke — every command listed by the registry executes through
      print mode returning a result envelope (no throw, no model call needed or scripted)
- [ ] TC-07: PTY — TUI boots to the prompt, `/` renders the autocomplete dropdown, `/help`
      executes as a command (not paste-bundled) at ≥30ms/key rate
- [ ] TC-08: PTY — `/exit` reaches process exit within 10s (CLI-071 confirmed fixed or the
      hang reproduced and recorded in the CLI-071 backlog with the captured state)
- [ ] TC-09: both SPEC.md test-strategy sections document the harness and its boundaries
      (testing subpath is dev-only; PTY suite isolation)

## Test Plan

Derived strategy (INFRA + cli): the harness IS the test infrastructure; each TC is a vitest
suite (PTY TCs in a dedicated vitest project).

| TC-ID | Test Type   | Tool / Approach                             | Notes                                      |
| ----- | ----------- | ------------------------------------------- | ------------------------------------------ |
| TC-01 | unit        | vitest — scripted provider behavior         |                                            |
| TC-02 | integration | vitest — startCli print mode + temp repo    |                                            |
| TC-03 | integration | vitest — permission matrix variants         |                                            |
| TC-04 | integration | vitest — two startCli runs, shared store    |                                            |
| TC-05 | integration | vitest — envelope shape assertions          |                                            |
| TC-06 | integration | vitest — registry-driven command sweep      |                                            |
| TC-07 | integration | vitest + node-pty — real PTY input pipeline | dedicated vitest project, generous timeout |
| TC-08 | integration | vitest + node-pty — shutdown deadline       | CLI-071 confirmation                       |
| TC-09 | manual      | SPEC.md diff review                         | doc change — reviewed in PR diff           |

## Tasks

- [ ] `.agents/tasks/CLI-074.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-12

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: INFRA` (valid 11-prefix value); `tags: [cli, typescript]` present
- Problem: concrete symptoms present (CLI-063/064 defect classes, expect(1) paste-bundling output `[Pasted text #1 +3 lines]`); reproduction conditions present (live-LLM-only detection in CI, PTY typing at burst and ~50ms/char); no TBD/TODO or vague single-sentence descriptions
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (per-test inline provider stubs, mock-mcp-server, createMockSession enumerated); 3 alternatives each with pro/con; Decision references the driving trade-offs (real-layer coverage of verified defect classes vs. native build cost, with nightly-gating mitigation)
- Completion Criteria: 9 items, all TC-N prefixed (TC-01–TC-09); ≥1 criterion per sub-item (scripted provider, tool loop, permissions, resume, output contracts, slash commands, PTY input, PTY shutdown, SPEC docs); all use Command/Observable form; no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found
- Test Plan: section present; 9 rows match 9 TC-N entries (count 9 = 9); every row has non-empty Test Type and Tool/Approach, no "TBD"; sole manual row (TC-09) has non-empty Notes explaining why ("doc change — reviewed in PR diff")
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in body
