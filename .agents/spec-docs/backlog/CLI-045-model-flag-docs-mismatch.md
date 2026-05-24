---
status: review-ready
type: BEHAVIOR
tags: [cli, docs]
---

# CLI-045: README의 --model 플래그 문서와 구현 불일치 해소

## Problem

`packages/agent-cli/README.md`에서 `robota --model claude-opus-4-7` 예시를 제시하지만 `cli-args.ts`의 `PARSE_ARGS_CONFIG`에 `model` 옵션이 없고 `IParsedCliArgs`에도 없다. 사용자가 `--model` 플래그를 사용하면 무시된다.

재현 조건: `robota --model claude-haiku-4-5 -p "hello"` 실행 → `--model` 무시, README와 동작 불일치.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/cli-args.ts` — `model?: string` 옵션 추가
- `packages/agent-cli/src/startup/args-to-options.ts` — model 옵션을 provider 설정에 반영
- `packages/agent-cli/README.md` — 구현과 일치하도록 확인

### Alternatives Considered

- **Alt A (채택): --model 플래그 구현** — Pro: README 예시가 실제로 동작, 사용자 경험 개선. Con: provider 설정 오버라이드 로직 추가 필요.
- **Alt B: README에서 --model 예시 제거** — Pro: 구현 변경 불필요. Con: 유용한 기능을 문서에서 제거, 사용자가 모델 변경 방법을 찾기 어려워짐.

### Decision

Alt A 채택. `--model` 플래그는 자연스러운 사용 패턴이며 구현하는 것이 맞다. `IParsedCliArgs`에 `model?: string` 추가, `args-to-options.ts`에서 provider 모델 오버라이드 처리.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — cli-args.ts, args-to-options.ts 옵션 처리 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`IParsedCliArgs`에 `model?: string` 추가. `PARSE_ARGS_CONFIG`에 `model: { type: 'string' }` 추가. `args-to-options.ts`에서 `model` 값이 있으면 provider 설정의 모델을 오버라이드.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/args-to-options.ts`
- `packages/agent-cli/README.md`

## Completion Criteria

- [ ] TC-01: `robota --model claude-haiku-4-5 -p "hello"` → 지정 모델로 응답 생성
- [ ] TC-02: `--model` 미사용 시 기본 provider 모델이 그대로 사용됨
- [ ] TC-03: `IParsedCliArgs`에 `model?: string` 타입 추가 (타입 체크 통과)
- [ ] TC-04: README 예시 코드가 실제 동작과 일치

## Test Plan

| TC-ID | Test Type | Tool / Approach                        | Notes                                             |
| ----- | --------- | -------------------------------------- | ------------------------------------------------- |
| TC-01 | unit      | vitest — args-to-options model mapping | Pass --model value, verify provider model updated |
| TC-02 | unit      | vitest — no model flag default path    | Omit --model, verify default provider model kept  |
| TC-03 | unit      | pnpm typecheck                         | TypeScript compilation passes with new field      |
| TC-04 | manual    | README example execution check         | Run README example, verify it works as documented |

## Tasks

- [ ] `.agents/tasks/CLI-045.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` present, `type: BEHAVIOR` is a valid 11-prefix value, `tags: [cli, docs]` present.
- Problem section: concrete symptom given (missing `model` option in `PARSE_ARGS_CONFIG` and `IParsedCliArgs`, flag silently ignored); reproduction condition given (`robota --model claude-haiku-4-5 -p "hello"`); no TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence ("cli-args.ts, args-to-options.ts 옵션 처리 구조 확인"); 2 alternatives (Alt A, Alt B) each with pro/con; decision references the trade-off (implementing the flag vs. removing from docs).
- Completion Criteria: TC-01 through TC-04 each carry a `TC-N` prefix; 4 criteria cover distinct sub-items; each uses Observable behavior or Command form; none use forbidden vague phrases.
- Test Plan: `## Test Plan` section present; 4 rows matching TC-01–TC-04 (count matches); all rows have non-empty Test Type and Tool/Approach with no TBD; TC-04 manual row has a non-empty Notes entry explaining why automated test is not possible.
- Structure: `## Tasks` section present; `## Evidence Log` section was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count match: Completion Criteria has 4 (TC-01–TC-04); Test Plan has 4 rows (TC-01–TC-04). ✅ Match confirmed.
