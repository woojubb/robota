---
status: approved
type: BEHAVIOR
tags: [cli, permissions]
---

# CLI-046: --denied-tools 플래그 추가

## Problem

`--allowed-tools`로 허용 도구를 화이트리스트 지정할 수 있지만 특정 도구만 제외하는 블랙리스트 방식(`--denied-tools`)이 없다. 읽기 전용 모드(Bash/Write 제외)나 순수 대화 모드를 간단하게 표현할 수 없다.

재현 조건: `robota --denied-tools Bash` 실행 → `--denied-tools` 플래그가 파싱되지 않아 Bash 도구가 그대로 허용됨.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/cli-args.ts` — `denied-tools` 옵션 추가
- `packages/agent-cli/src/startup/args-to-options.ts` — denied-tools를 permission enforcer에 연결

### Alternatives Considered

- **Alt A (채택): --denied-tools 플래그로 permission enforcer deny list 연결** — Pro: 직관적인 블랙리스트 UX, 기존 permission enforcer 구조 재활용. Con: allowed와 denied 동시 사용 시 우선순위 규칙 명시 필요.
- **Alt B: --allowed-tools ""로 전체 차단** — Pro: 기존 플래그 재활용. Con: 빈 문자열 전달이 직관적이지 않고, 특정 도구만 제외하는 패턴을 표현할 수 없음.

### Decision

Alt A 채택. denied-tools를 별도 플래그로 추가하여 명확한 블랙리스트 UX 제공. denied가 allowed보다 우선하는 규칙으로 명시.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — cli-args.ts, permission-enforcer.ts 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`cli-args.ts`에 `denied-tools: { type: 'string' }` 추가. `args-to-options.ts`에서 쉼표 파싱 후 permission enforcer deny list에 전달. `*` 지정 시 모든 도구 차단.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/args-to-options.ts`

## Completion Criteria

- [ ] TC-01: `--denied-tools Bash` → Bash 도구 실행이 차단됨
- [ ] TC-02: `--denied-tools "*"` → 모든 도구 차단
- [ ] TC-03: `--allowed-tools`와 `--denied-tools` 동시 사용 시 denied가 우선

## Test Plan

| TC-ID | Test Type | Tool / Approach                       | Notes                                          |
| ----- | --------- | ------------------------------------- | ---------------------------------------------- |
| TC-01 | unit      | vitest — args-to-options denied-tools | Pass Bash to denied-tools, verify Bash blocked |
| TC-02 | unit      | vitest — wildcard denied-tools        | Pass "\*", verify all tools blocked            |
| TC-03 | unit      | vitest — allowed+denied conflict      | Pass overlapping sets, verify denied wins      |

## Tasks

- [ ] `.agents/tasks/CLI-046.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` confirmed, `type: BEHAVIOR` is valid (in 11-prefix list), `tags: [cli, permissions]` present.
- Problem section: Concrete symptom present (`robota --denied-tools Bash` → flag not parsed, Bash tool remains allowed). Reproduction condition present (specific command). No TBD/TODO/vague language.
- Architecture Review Checklist: All 4 items checked `[x]`. Sibling scan `[x]` with evidence (`cli-args.ts, permission-enforcer.ts` structure confirmed). Alternatives Considered has 2 entries (Alt A and Alt B) each with pro/con. Decision references the trade-off (denied > allowed priority rule, explicit blacklist UX).
- Completion Criteria: All 3 items (TC-01, TC-02, TC-03) have TC-N prefix. Each uses observable behavior form. No vague language ("차단됨", "우선" — measurable outcomes).
- Test Plan: Section present. 3 rows matching TC-01, TC-02, TC-03 (count matches). All rows have non-empty Test Type (unit) and Tool/Approach (vitest with specific test name). No manual rows requiring Notes justification.
- Structure: Tasks section present with placeholder. Evidence Log was empty before this entry. No `## Status` or `## Classification` sections in body.
- TC-N count check: Completion Criteria = 3 (TC-01, TC-02, TC-03); Test Plan rows = 3 (TC-01, TC-02, TC-03) — counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)
