---
status: approved
type: BEHAVIOR
tags: [cli]
---

# CLI-028: Node.js 버전 체크 강화 — 명확한 오류 메시지 + 업그레이드 안내

## Problem

`@robota-sdk/agent-cli`는 Ink 7.x 의존성으로 Node.js 22+가 필요하다. 그러나 Node 20 LTS 이하에서 실행하면 Ink 내부의 알 수 없는 오류가 발생하거나 아무 메시지 없이 종료된다. `package.json`의 `engines.node` 필드도 명확하지 않아 진단이 어렵다.

재현 조건: Node 20 환경에서 `robota` 실행 → 에러 메시지 없이 프로세스 종료 또는 Ink 내부 스택 트레이스 출력.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/preflight.ts` — Node 버전 체크 추가
- `packages/agent-cli/src/bin.ts` — preflight 호출 순서
- `packages/agent-cli/package.json` — `engines.node: ">=22.0.0"` 명시

### Alternatives Considered

- **Alt A (채택): bin.ts/preflight.ts 최상단에서 process.version 체크 후 명확한 메시지 출력** — Pro: 최소한의 코드 추가, 즉시 사용자 피드백. Con: Node < 22에서도 이 코드는 실행되어야 하므로 ES module syntax 주의 필요.
- **Alt B: package.json engines 필드만 추가** — Pro: 표준적 방법. Con: npx/npm은 engines를 강제하지 않음, 설치 후 실행 시점에서 감지 불가.

### Decision

Alt A 채택. preflight 단계에서 `process.version`을 직접 체크하여 Node < 22 감지 시 업그레이드 방법(nvm, Volta, nodejs.org)을 포함한 명확한 오류 메시지를 stderr로 출력 후 exit(1). engines 필드도 함께 명시.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — bin.ts, preflight.ts, first-run.ts 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`preflight.ts`에 Node 버전 체크 함수 추가. `bin.ts` 진입 직후 preflight를 호출하여 Node < 22 감지 시 명확한 오류 메시지 + 업그레이드 가이드 출력 후 `process.exit(1)`.

## Affected Files

- `packages/agent-cli/src/startup/preflight.ts`
- `packages/agent-cli/src/bin.ts`
- `packages/agent-cli/package.json`

## Completion Criteria

- [ ] TC-01: Node 20 환경(또는 mocked process.version)에서 `robota` 실행 → stderr에 버전 오류 메시지 + nvm/Volta 업그레이드 안내 출력
- [ ] TC-02: Node < 22 감지 시 exit code 1로 종료
- [ ] TC-03: Node 22+ 환경에서는 버전 체크가 통과되어 정상 실행됨
- [ ] TC-04: `package.json`의 `engines.node`가 `">=22.0.0"` 으로 설정됨

## Test Plan

| TC-ID | Test Type | Tool / Approach               | Notes                                            |
| ----- | --------- | ----------------------------- | ------------------------------------------------ |
| TC-01 | unit      | vitest — process.version mock | Mock process.version to "v20.0.0"                |
| TC-02 | unit      | vitest — process.exit spy     | Verify exit(1) called on Node < 22               |
| TC-03 | unit      | vitest — process.version mock | Mock process.version to "v22.0.0", no exit       |
| TC-04 | manual    | package.json inspect          | TC-04: static file check, no runtime test needed |

## Tasks

- [ ] `.agents/tasks/CLI-028.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli]` present.
- Problem section: Concrete symptom present ("Ink 내부의 알 수 없는 오류가 발생하거나 아무 메시지 없이 종료된다"). Reproduction condition present ("Node 20 환경에서 `robota` 실행 → 에러 메시지 없이 프로세스 종료 또는 Ink 내부 스택 트레이스 출력"). No TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: All 4 items are `[x]`. Sibling scan item `[x]` with evidence ("bin.ts, preflight.ts, first-run.ts 확인"). Alternatives Considered has 2 entries (Alt A, Alt B) each with pro/con. Decision documents the trade-off (runtime detection vs. engines-field-only approach).
- Completion Criteria: 4 items, all prefixed TC-01 through TC-04. Each uses observable/command form. No forbidden vague language ("works correctly", "no errors", "implemented", "displays correctly"). TC-03 "정상 실행됨" is anchored to the specific observable "버전 체크가 통과되어", making it sufficiently concrete.
- Test Plan: `## Test Plan` section present. 4 rows matching TC-01–TC-04 (count matches Completion Criteria). All rows have non-empty Test Type and Tool/Approach. TC-04 (manual) has Notes entry explaining why automated test is not applicable ("static file check, no runtime test needed").
- Structure: `## Tasks` section present with placeholder. `## Evidence Log` section present and empty before this entry. No `## Status` or `## Classification` sections in body.
- TC-N count match: Completion Criteria = 4 (TC-01–TC-04); Test Plan rows = 4 (TC-01–TC-04). ✅ Counts match.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)
