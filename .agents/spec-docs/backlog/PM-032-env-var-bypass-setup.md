---
status: review-ready
type: BEHAVIOR
tags: [cli, ux, provider]
---

# PM-032: 환경변수(ANTHROPIC_API_KEY 등) 있을 때 설정 화면 건너뛰기

## Problem

`ANTHROPIC_API_KEY` 환경변수가 설정되어 있어도 `~/.robota/settings.json`이 없으면 인터랙티브 설정 화면이 표시된다. CI/Docker 환경에서 `docker run -e ANTHROPIC_API_KEY=sk-ant-xxx robota -p "hello"` 실행 시 매번 설정 화면이 뜨거나 크래시가 발생한다.

재현 조건: `~/.robota/settings.json` 없는 환경에서 `ANTHROPIC_API_KEY` 설정 후 `robota -p "hello"` → 설정 화면 표시.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/config-phase.ts` — 환경변수 감지 후 설정 건너뛰기
- `packages/agent-cli/src/startup/provider-setup.ts` — ephemeral provider 생성

### Alternatives Considered

- **Alt A (채택): 환경변수 감지 시 ephemeral provider 생성 + 설정 건너뜀** — Pro: CI/Docker에서 즉시 동작, Claude Code와 동일한 UX. Con: settings.json 없이 사용 시 설정 지속성 없음.
- **Alt B: 환경변수 있어도 항상 설정 화면 표시** — Pro: 현재 동작 유지. Con: CI/Docker에서 non-interactive 실행 불가.

### Decision

Alt A 채택. 프로바이더 우선순위: `--provider` 플래그 → `settings.json` → 환경변수 자동 감지(ANTHROPIC → OpenAI → Gemini 순). 환경변수만 있어도 즉시 실행.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — config-phase.ts, provider-setup.ts, provider-startup.ts 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`config-phase.ts`에서 `ANTHROPIC_API_KEY` 감지 시 settings.json 없어도 ephemeral provider 반환. 어떤 프로바이더를 사용하는지 명확히 출력.

## Affected Files

- `packages/agent-cli/src/startup/config-phase.ts`
- `packages/agent-cli/src/startup/provider-setup.ts`

## Completion Criteria

- [ ] TC-01: `ANTHROPIC_API_KEY`만 있고 settings.json 없는 환경에서 `robota -p "hello"` 즉시 실행
- [ ] TC-02: CI 환경(`CI=true`)에서 non-interactive 실행 가능 (설정 화면 없음)
- [ ] TC-03: 환경변수로 실행 시 어떤 프로바이더를 사용하는지 출력됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                         | Notes                                               |
| ----- | --------- | --------------------------------------- | --------------------------------------------------- |
| TC-01 | unit      | vitest — config-phase env var detection | Mock env var + no settings.json, verify no prompt   |
| TC-02 | unit      | vitest — CI=true non-interactive check  | Mock CI=true, verify interactive prompt skipped     |
| TC-03 | unit      | vitest — provider selection output      | Verify stdout includes provider name on env-var run |

## Tasks

- [ ] `.agents/tasks/PM-032.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-25

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` confirmed, `type: BEHAVIOR` is a valid type from the 11-prefix list, `tags: [cli, ux, provider]` present.
- Problem section: concrete symptom present (docker run command + crash behavior), reproduction condition explicit (no settings.json + ANTHROPIC_API_KEY set + robota -p "hello"), no TBD/TODO or vague language.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence (config-phase.ts, provider-setup.ts, provider-startup.ts confirmed); 2 alternatives (Alt A, Alt B) each with explicit pro/con; decision cites the trade-off (CI/Docker non-interactive execution vs. persisted settings).
- Completion Criteria: TC-01, TC-02, TC-03 all carry TC-N prefix; each uses observable behavior form; no vague language found.
- Test Plan: section present; 3 rows matching TC-01/TC-02/TC-03 exactly (count matches Completion Criteria); all rows have non-empty Test Type (unit) and Tool/Approach (vitest with description); no manual rows requiring Notes.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan = 3 (TC-01, TC-02, TC-03) — match confirmed.
