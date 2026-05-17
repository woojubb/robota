---
title: 'CLIR-L01: agentName 하드코딩 — robota-cli 문자열 상수로 추출'
status: todo
created: 2026-05-17
priority: low
urgency: later
area: packages/agent-cli
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #L-01

`agentName: 'robota-cli'` 문자열 리터럴이 두 파일에 중복 정의되어 있다.

```typescript
// print-mode.ts:70
agentName: 'robota-cli',

// tui-mode.ts:58
agentName: 'robota-cli',
```

## 규칙 참조

- `code-quality.md` — "No magic numbers or strings. Use named constants."

## 권장 조치

`packages/agent-cli/src/constants.ts` (또는 기존 `startup/version.ts`)에
`export const AGENT_CLI_NAME = 'robota-cli'`를 선언하고 두 파일이 import한다.

`readVersion()`으로 이미 CLI 버전을 읽고 있으므로, 패키지 이름도 같은 방식으로
`package.json`에서 읽거나 상수로 추출할 수 있다.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `grep -n "'robota-cli'" packages/agent-cli/src/modes/print-mode.ts packages/agent-cli/src/modes/tui-mode.ts` — 결과 없음 (상수 참조로 교체됨)
- [ ] 상수가 단일 파일에서만 정의됨을 확인

## User Execution Test Scenarios

이 작업은 내부 상수 추출이다. 사용자 관점의 CLI 동작은 변경되지 않는다.

Not applicable — 하드코딩된 문자열을 상수로 추출하는 순수 내부 리팩토링으로,
사용자가 관찰 가능한 제품 동작 변화가 없다. 빌드 및 typecheck 통과로 검증한다.
