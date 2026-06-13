---
status: in-progress
type: OBSERVABILITY
tags: [cli, typescript, async]
---

# OBS-001: Session Log Analyzer — 세션 로그 기반 성능 분석 도구

## Problem

세션 로그에는 각 history 항목마다 `timestamp` 필드가 기록되어 있으나, 이를 분석하는 도구가 없다.

현재 상황:

- LLM API 응답 대기 vs 코드 내부 처리 지연을 구분할 수 없음
- user → assistant 응답 시간, tool 호출 간격 등 기본 타이밍 통계를 즉시 확인할 방법이 없음
- 성능 문제 발생 시 어느 구간에서 발생하는지 추적이 불가능
- 세션별 컨텍스트 토큰 누적이 응답 속도에 미치는 영향 파악 불가

재현 조건: 세션 종료 후 세션 JSON 파일이 생성되어 있을 때, 어느 구간이 느렸는지 확인하려 해도 분석 도구가 없음.

### Real-binary verification finding (2026-06-13) — the shipped command is broken

An initial implementation shipped (parser/reporter unit tests pass), but a real-binary run of
the actual CLI revealed it never works in practice — two integration bugs the unit tests
could not catch:

1. **Session-path mismatch (TC-01/02/07 fail):** every session (print and TUI) is persisted to
   `cwd/.robota/sessions` via `createProjectSessionStore(cwd)` (`projectPaths`), but
   `runSessionAnalyze` reads only `userPaths().sessions` (`~/.robota/sessions`). `robota session
analyze` therefore reports "No session files found" even immediately after creating sessions.
   (The original spec assumed user-level storage; the session store moved to project-level
   afterward, leaving the analyzer pointed at the wrong directory.)
2. **`--last`/`--session` rejected (TC-02/07 fail):** `startCli` runs `parseCliArgs()` (Node
   `parseArgs`, strict) before the `session analyze` dispatch, so the unknown `--last`/`--session`
   options throw "Unknown option" and never reach `runSessionAnalyze`.

This is the exact false-done class HARNESS-002 guards against — done evidence (unit tests) was
real but the user-facing feature was non-functional.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/commands/` — 새 CLI 서브커맨드 `robota session analyze` 추가
- `packages/agent-cli/src/` — session log 파서/분석 모듈
- `~/.robota/sessions/*.json` — 읽기 전용 데이터 소스 (수정 없음)

### Alternatives Considered

**A. 독립 스크립트 (`scripts/analyze-sessions.ts`)**

- Pro: 빠르게 만들 수 있음, 패키지 경계에 영향 없음
- Con: `pnpm robota` CLI에 통합되지 않음, 일반 사용자 접근 어려움

**B. `robota session analyze` CLI 서브커맨드**

- Pro: 기존 CLI UX와 통합, 탭 완성·help 자동 지원, 향후 `robota session list/clean` 등 확장 자연스러움
- Con: agent-cli 패키지에 파서 로직 추가 필요

**C. 외부 분석 도구 (Python 스크립트 별도 제공)**

- Pro: 빠른 프로토타이핑
- Con: 별도 런타임 의존성, 배포 복잡도 증가, 프로젝트 언어 불일치

### Decision

**B 채택** — `robota session analyze` 서브커맨드로 구현. 기존 CLI 명령어 패턴(`/context`, `/session` 등)과 일관성을 유지하며, 일반 사용자도 바로 실행 가능. 파서는 `packages/agent-cli/src/session-analyzer/` 에 분리하여 테스트 가능하도록 구성.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `packages/agent-cli/src/commands/` 기존 커맨드 전체 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`~/.robota/sessions/*.json` 파일을 파싱하여 아래 타이밍 구간을 자동 계산하고 텍스트 리포트로 출력한다.

**계산할 타이밍 구간:**

| 구간 ID              | from                    | to                                  | 의미                                       |
| -------------------- | ----------------------- | ----------------------------------- | ------------------------------------------ |
| `user_to_first_tool` | `type: user`            | `type: tool-start`                  | LLM이 첫 tool 결정까지 걸린 시간           |
| `user_to_assistant`  | `type: user`            | `type: assistant`                   | tool 없이 바로 응답한 경우 전체 LLM 시간   |
| `tool_exec`          | `type: tool-start`      | `type: tool-end`                    | 실제 도구 실행 시간 (코드 처리)            |
| `llm_between_tools`  | `type: tool-end`        | `type: tool-start`                  | tool 결과 읽고 다음 tool 결정까지 LLM 시간 |
| `llm_final_response` | `type: tool-end` (last) | `type: tool-summary` or `assistant` | 모든 tool 완료 후 최종 응답 생성 LLM 시간  |

**출력 형식 (단일 세션):**

```
Session: session_1777577727111_g65ex0vgb
Created: 2026-04-30 19:35 | Messages: 6 turns

Timing Summary:
  LLM API wait (total)   23,400ms avg  |  56,463ms max
  Tool execution (code)     820ms avg  |     120ms median
  user → assistant          18,200ms avg

Slow intervals (>10s):
  turn 3  tool-end → assistant  34,112ms  ← LLM final response
  turn 2  user → tool-start     11,400ms  ← LLM first decision

Verdict: Bottleneck is LLM API wait (95%). Code processing: <1%.
```

**집계 모드 (여러 세션):**

```
robota session analyze --last 30

Analyzed 30 sessions (2026-04-01 ~ 2026-05-01)
  Avg LLM response:   23s
  Avg tool exec:      15ms
  Max single delay:   76s (session_xxx, turn 5, tool-end→summary)
  Context spike warning: 3 sessions exceeded 70k tokens
```

## Affected Files

_Corrected 2026-06-13 to the real on-disk layout + the two integration fixes:_

- `packages/agent-cli/src/session-analyzer/parser.ts` — JSON 파싱 + 타이밍 계산 (unchanged)
- `packages/agent-cli/src/session-analyzer/reporter.ts` — 텍스트 리포트 포매터 (unchanged)
- `packages/agent-cli/src/session-analyzer/types.ts` — 타이밍 타입 (unchanged)
- `packages/agent-cli/src/session-analyzer/session-analyze-command.ts` — **fix:** read sessions
  from project-level (`projectPaths(cwd).sessions`) AND user-level (`userPaths().sessions`),
  merged and de-duplicated; this is where the actual command entry lives (the spec's old
  `commands/session-analyze-command.ts` path was never the real location)
- `packages/agent-cli/src/cli.ts` — **fix:** intercept `session analyze` BEFORE `parseCliArgs()`
  so `--last`/`--session` reach the subcommand instead of being rejected by the strict global parser
- `packages/agent-cli/src/session-analyzer/__tests__/parser.test.ts` (TC-03/04/05, exists)
- `packages/agent-cli/src/session-analyzer/__tests__/reporter.test.ts` (TC-05, exists)
- `packages/agent-cli/src/session-analyzer/__tests__/session-analyze-command.test.ts` — **new:**
  integration tests for the path resolution + flag handling (TC-01/02/06/07)

## Completion Criteria

- [ ] TC-01: `robota session analyze` 실행 시 최근 세션 1개의 타이밍 리포트가 stdout에 출력됨
- [ ] TC-02: `robota session analyze --last 10` 실행 시 최근 10개 세션의 집계 통계가 출력됨
- [ ] TC-03: 각 history 항목 간 `gap_ms`가 ISO 8601 timestamp 파싱으로 정확히 계산됨 (unit test)
- [ ] TC-04: `tool-start → tool-end` 구간이 "코드 처리"로, `tool-end → tool-start` 구간이 "LLM 대기"로 올바르게 분류됨 (unit test)
- [ ] TC-05: 10초 이상 구간은 "Slow intervals" 섹션에 별도 표시됨
- [ ] TC-06: 세션 파일이 없거나 파싱 실패 시 명확한 오류 메시지 출력 후 exit 1
- [ ] TC-07: `--session <id>` 플래그로 특정 세션 지정 분석 가능

## Test Plan

| TC-ID | Test Type   | Tool / Approach                     | Notes                                |
| ----- | ----------- | ----------------------------------- | ------------------------------------ |
| TC-01 | Integration | Process spawn + stdout assertion    | 실제 `~/.robota/sessions/` 파일 사용 |
| TC-02 | Integration | Process spawn + stdout assertion    | fixture 세션 파일 사용               |
| TC-03 | Unit        | vitest — timestamp diff 계산 검증   |                                      |
| TC-04 | Unit        | vitest — 구간 분류 로직 검증        |                                      |
| TC-05 | Unit        | vitest — slow interval 필터링 검증  |                                      |
| TC-06 | Integration | Process spawn + exit code assertion | 빈 디렉터리로 테스트                 |
| TC-07 | Integration | Process spawn + `--session` flag    |                                      |

## Tasks

- [ ] `.agents/tasks/OBS-001.md` — T1~T9 (TC-01~TC-07 매핑 + integration test + wrap-up)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-31

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: OBSERVABILITY` is valid 11-prefix value; `tags: [cli, typescript, async]` present.
- Problem section: Concrete symptom stated (no analysis tool for `~/.robota/sessions/*.json` timing data); reproduction condition specified ("세션 종료 후 `~/.robota/sessions/`에 JSON 파일이 생성되어 있을 때"); no TBD/TODO/vague single-sentence descriptions found.
- Architecture Review Checklist: All 4 items are `[x]`; sibling scan item `[x]` with evidence ("기존 커맨드 전체 확인"); Alternatives Considered has 3 entries (A, B, C) each with Pro/Con; Decision documents the trade-off driving choice B.
- Completion Criteria: 7 items (TC-01 through TC-07), all prefixed with TC-N; all use Command or Observable behavior form; no vague language ("works correctly", "no errors", etc.) found.
- Test Plan: Section present; 7 rows matching TC-01 through TC-07 (count matches Completion Criteria); all rows have non-empty Test Type and Tool/Approach; no "manual" rows requiring Notes justification.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count check: Completion Criteria = 7 (TC-01–TC-07); Test Plan rows = 7 — exact match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-31

**Status upgrade:** review-ready → approved

- User approval statement (verbatim): "승인합니다. 그 두 백로그의 우선순위를 잘 정해서 진행해줘."
- Statement is unambiguous and directs implementation of both BEHAVIOR-001 and OBS-001.
- No architecture or frontmatter changes after approval.

### [GATE-APPROVAL] — ❌ FAIL | 2026-05-31

**Status remains:** review-ready
**Failed criteria:**

- User explicit approval: No approval statement was found in the current conversation. Required one of: "승인", "진행해", "맞아 진행해", "ok 시작해", "끝까지 책임지고 작업해", or any unambiguous statement confirming the design and authorizing implementation for OBS-001.
  **Required action:** User must provide an explicit approval statement directed at this spec document (OBS-001) before re-running GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- User approval statement (verbatim): "제대로 고쳐서 작동하게 (권장)" — chosen in response to a plain-language summary of the two real-binary bugs, explicitly authorizing the OBS-001 fix to actually work (read project-level + user-level sessions, intercept `session analyze` before parseCliArgs, add integration tests, verify on the real binary against all 7 TCs).
- Statement is unambiguous and directed at this spec document: it confirms the corrected Problem ("Real-binary verification finding") and Affected Files path corrections and authorizes implementation of the fix. This supersedes the spurious FAIL above (logged by a guard that could not see the prior 2026-05-31 approval).
- No Architecture Review or frontmatter type/tags modified inappropriately: `type: OBSERVABILITY` and `tags: [cli, typescript, async]` unchanged; Architecture Review Checklist items remain all `[x]`; `status` set to review-ready to reflect the corrected gate state before this approval. The Problem real-binary finding and Affected Files corrections are within the approved fix scope.
- NON-COMPLIANCE check: no new implementation commits for the fix exist on branch `fix/obs-001-session-analyze` (`git log develop..HEAD` empty; only the spec edit is in the working tree). The pre-existing shipped code is the prior (broken) implementation, not new work for this gate — trigger not met.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/OBS-001.md` exists (untracked in working tree on branch `fix/obs-001-session-analyze`), containing T1–T9.
- Tasks file path recorded in spec `## Tasks` section: line reads `` `.agents/tasks/OBS-001.md` — T1~T9 (TC-01~TC-07 매핑 + integration test + wrap-up) `` — confirmed.
- Tasks correspond to Completion Criteria (≥1 task per TC-N): TC-01→T1, TC-02→T2, TC-03→T3, TC-04→T4, TC-05→T5, TC-06→T6, TC-07→T7 — all 7 TCs mapped; plus T8 (new `session-analyze-command.test.ts` integration test for the path-merge + flag-delivery fixes) and T9 (wrap-up: test/typecheck/lint/build + real-binary 7-TC verification + GATE-VERIFY/COMPLETE).
- NON-COMPLIANCE trigger check (implementation commits exist but no tasks file): not met — `git log develop..HEAD` is empty (no fix-implementation commits), tasks file is present, and the working tree contains only spec/tasks doc changes. The pre-existing broken parser/reporter/command code is the prior implementation, not new fix work for this gate.
