---
title: 'MKT-010: npx robota 단축 실행 — npm 패키지명 별칭 등록'
status: todo
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-cli, npm 배포
depends_on: []
---

## Background

현재 `npx @robota-sdk/agent-cli`로 실행해야 한다. `npx robota`로 공유·바이럴되는 단일 명령이 없으면 입소문 전파가 불가능하다.

## 작업 항목

- npm에 `robota` 패키지명 등록 가능 여부 확인 (현재 점유 여부 조회)
- 가능한 경우: `robota` 패키지를 `@robota-sdk/agent-cli`의 redirect/alias 패키지로 등록
- 또는: `@robota-sdk/agent-cli`의 `package.json` `name` 필드를 `robota`로 변경하고 `@robota-sdk/agent-cli`를 peerDependency alias로 유지
- README, 공식 문서, 모든 예제에서 `npx robota`를 기본 명령으로 교체

## Test Plan

- `npx robota --version` 동작 확인
- `npx @robota-sdk/agent-cli` 하위 호환성 확인 (패키지명 변경 시)

## User Execution Test Scenarios

### Scenario 1: npx 단축 실행

```bash
npx robota --version
```

Expected: robota 버전 출력
