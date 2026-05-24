---
status: review-ready
type: BEHAVIOR
tags: [cli, ux, diagnose]
---

# PM-035: diagnose 커맨드 4가지 버그 수정

## Problem

`robota diagnose` 출력이 실제 상태를 반영하지 않는 4가지 결함이 있다.

1. `checkApiKey()`가 `ANTHROPIC`, `OPENAI`, `GEMINI`, `DEEPSEEK`만 체크 — `DASHSCOPE_API_KEY`(Qwen 프로바이더) 누락
2. `checkNetwork()`가 현재 프로바이더 설정과 무관하게 항상 `api.anthropic.com:443`만 체크 — OpenAI 사용자에게는 의미 없는 결과 반환
3. `checkSettingsFile()`이 파일 존재 여부만 확인 — 손상된 JSON이나 스키마 불일치를 감지하지 못해 `diagnose` 통과 후 런타임 크래시 가능
4. `diagnose` 출력 안내 메시지에 `robota configure`로 표시 — 실제 플래그는 `robota --configure`

재현 조건: `DASHSCOPE_API_KEY` 설정 상태에서 `robota diagnose` 실행 → API key check에서 Qwen 키가 표시 안 됨. 또는 손상된 `settings.json` 상태에서 `robota diagnose` 실행 → 이상 없음으로 통과 후 실행 시 크래시.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/diagnose-command.ts` — checkApiKey, checkNetwork, checkSettingsFile, 안내 메시지 수정

### Alternatives Considered

- **Alt A (채택): diagnose-command.ts 내 4개 함수 직접 수정** — Pro: 단일 파일 수정, 테스트 범위 명확. Con: checkNetwork는 설정 조회 로직 의존성 추가 필요.
- **Alt B: 별도 diagnosis-checks.ts로 분리 리팩토링 후 수정** — Pro: 테스트 용이성 향상. Con: PM-035 범위를 초과하는 리팩토링, 관련 없는 변경 혼재.

### Decision

Alt A 채택. 파일 하나 수정으로 4개 버그 일괄 수정. checkNetwork에서 현재 설정된 provider 엔드포인트 조회는 기존 settings 읽기 로직을 재사용.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — diagnose-command.ts, provider 설정 로딩 경로 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`checkApiKey()`에 `DASHSCOPE_API_KEY` 추가. `checkNetwork()`가 현재 settings의 provider 값을 읽어 해당 엔드포인트를 체크. `checkSettingsFile()`에 `JSON.parse` 및 기본 스키마 필드 존재 확인 추가. 모든 안내 메시지에서 `robota --configure`로 통일.

## Affected Files

- `packages/agent-cli/src/startup/diagnose-command.ts`

## Completion Criteria

- [ ] TC-01: `DASHSCOPE_API_KEY` 환경변수 설정 시 `checkApiKey()` 결과에 Qwen 항목이 포함됨
- [ ] TC-02: 설정된 provider가 OpenAI인 경우 `checkNetwork()`가 `api.openai.com` 엔드포인트를 체크함
- [ ] TC-03: 손상된 JSON이 담긴 `settings.json`으로 `checkSettingsFile()` 실행 시 `invalid` 상태 반환
- [ ] TC-04: `diagnose` 출력의 안내 메시지에 `robota --configure` 형식이 사용됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                            |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------ |
| TC-01 | unit      | vitest — process.env DASHSCOPE_API_KEY mock | Verify Qwen entry appears in checkApiKey result  |
| TC-02 | unit      | vitest — settings provider mock (openai)    | Verify checkNetwork uses api.openai.com endpoint |
| TC-03 | unit      | vitest — corrupted JSON file mock           | Verify checkSettingsFile returns invalid status  |
| TC-04 | unit      | vitest — output string assertion            | Verify no `robota configure` without `--` prefix |

## Tasks

- [ ] `.agents/tasks/PM-035.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid from 11-prefix list; `tags: [cli, ux, diagnose]` present.
- Problem section: 4 concrete symptoms listed with specific function names and behaviors; reproduction condition explicitly stated ("재현 조건" paragraph); no "TBD", "TODO", or vague single-sentence descriptions found.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence ("diagnose-command.ts, provider 설정 로딩 경로 확인"); 2 alternatives (Alt A, Alt B) with pro/con for each; decision references trade-off (single-file fix vs. out-of-scope refactoring).
- Completion Criteria: 4 items, all with TC-N prefix (TC-01–TC-04); each uses observable behavior form; no forbidden vague language found.
- Test Plan: section present; 4 rows matching TC-01–TC-04 (count matches Completion Criteria); all rows have non-empty Test Type (unit) and Tool/Approach (vitest); no manual rows requiring Notes justification.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count: 4 in Completion Criteria, 4 in Test Plan — counts match.
