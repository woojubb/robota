---
status: review-ready
type: BEHAVIOR
tags: [cli]
---

# CLI-027: --system-prompt / --append-system-prompt 플래그 구현

## Problem

`--system-prompt <text>` 및 `--append-system-prompt <text>` 플래그가 README와 SPEC에 문서화되어 있으나 SPEC에 "parsed but not yet connected"로 명시된 채 미구현 상태였다. 플래그는 CLI 인자 파서(`cli-args.ts`)에서 읽히지만 실제 `InteractiveSession` 또는 print 모드에 전달되지 않았다.

재현 조건: `robota -p "List files" --system-prompt "Always respond in JSON format"` 실행 시 JSON이 아닌 일반 텍스트로 응답이 반환됨.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/cli-args.ts` — `systemPrompt`/`appendSystemPrompt` 파싱
- `packages/agent-cli/src/startup/command-setup.ts` — CLI 옵션 → 세션 옵션 변환
- `packages/agent-cli/src/modes/print-mode.ts` — print 모드 세션 생성 시 전달
- `packages/agent-cli/src/modes/tui-mode.ts` — TUI 모드 세션 생성 시 전달
- `packages/agent-framework/src/interactive/interactive-session-options.ts` — 옵션 타입

### Alternatives Considered

- **Alt A (채택): 파싱된 값을 세션 생성 옵션으로 직접 전달** — Pro: 기존 파서 구조 재사용, 최소 변경. Con: print/TUI 각각에 전달 로직 추가 필요.
- **Alt B: 환경변수로 우회 (ROBOTA_SYSTEM_PROMPT)** — Pro: 파이프라인 친화적. Con: 플래그 → ENV 우회는 사용자 혼란, 기존 `--system-prompt` 플래그 의미 훼손.

### Decision

Alt A 채택. 파서에서 이미 읽히는 `systemPrompt`/`appendSystemPrompt` 값을 `toSessionRunOptions` 변환 시 `InteractiveSession` 생성 옵션으로 전달. print 모드와 TUI 모드 양쪽에 동일 경로로 연결.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — agent-cli {print-mode, tui-mode, command-setup} 전부 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`cli-args.ts`에서 이미 파싱되는 `systemPrompt`/`appendSystemPrompt` 값을 `command-setup.ts`의 세션 옵션 변환 함수에서 `InteractiveSession` 생성 파라미터로 전달. print 모드와 TUI 모드 양쪽의 세션 생성 경로에 적용.

## Affected Files

- `packages/agent-cli/src/startup/command-setup.ts`
- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-cli/src/modes/tui-mode.ts`

## Completion Criteria

- [ ] TC-01: `robota -p "What is 2+2" --system-prompt "Always answer in Korean"` → 한국어 응답 반환
- [ ] TC-02: `robota -p "Summarize" --append-system-prompt "End with a disclaimer"` → 면책 조항이 응답에 포함됨
- [ ] TC-03: TUI 모드(`robota --system-prompt "..."`)에서도 시스템 프롬프트가 세션에 반영됨
- [ ] TC-04: `--system-prompt`와 `--append-system-prompt` 동시 사용 시 두 값이 모두 세션에 전달됨

## Test Plan

| TC-ID | Test Type   | Tool / Approach                           | Notes                                               |
| ----- | ----------- | ----------------------------------------- | --------------------------------------------------- |
| TC-01 | integration | Process spawn + stdout assertion (vitest) | Mock AI provider or real provider with API key      |
| TC-02 | integration | Process spawn + stdout assertion (vitest) | Mock AI provider or real provider with API key      |
| TC-03 | unit        | vitest — TuiTransport constructor spy     | Verify systemPrompt value passed to session options |
| TC-04 | unit        | vitest — session options assertion        | Verify both fields merged correctly                 |

## Tasks

- [ ] `.agents/tasks/CLI-027.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli]` present.
- Problem section: Concrete symptom present (`robota -p "List files" --system-prompt "Always respond in JSON format"` → plain text returned). Reproduction condition stated as specific command. No TBD/TODO/vague descriptions.
- Architecture Review Checklist: All 4 items are `[x]`. Sibling scan `[x]` with explicit evidence ("agent-cli {print-mode, tui-mode, command-setup} 전부 확인"). Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro and Con. Decision references the trade-off (minimal change via existing parser vs. ENV workaround causing user confusion).
- Completion Criteria: All 4 items carry TC-N prefix (TC-01 through TC-04). Each uses command form or observable behavior form. Prohibited language ("works correctly", "no errors", "implemented", "displays correctly") not found.
- Test Plan: `## Test Plan` section present. 4 rows match 4 TC-N criteria exactly. Every row has non-empty Test Type and Tool/Approach; no "TBD". No manual-only rows requiring Notes explanation.
- Structure: `## Tasks` section present with placeholder. `## Evidence Log` section present and was empty before this entry. No `## Status` or `## Classification` sections found in body.
- TC-N count match: Completion Criteria = 4 (TC-01–TC-04); Test Plan rows = 4 (TC-01–TC-04). ✓
