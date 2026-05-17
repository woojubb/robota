---
title: 'ARCH-FIX-030: move readPackageVersion utility to agent-framework'
status: done
created: 2026-05-17
priority: medium
urgency: soon
area: packages/agent-cli, packages/agent-framework
---

## Problem

`packages/agent-cli/src/startup/version.ts`가 패키지 버전 읽기 로직을 소유하고 있다.
버전 표시는 CLI 전용 기능이 아니다 — `agent-transport/tui`, `agent-transport/headless`,
웹 UI 등 어떤 transport shell도 버전을 표시해야 할 수 있다.
CLI가 이 로직을 소유하면 재사용이 불가능하다.

추가로 현재 구현의 불필요한 외부 try-catch (inner candidates loop만으로 충분)와
`allow-fallback` 주석 두 개도 함께 제거한다.

## Proposed Change

`agent-framework`에 범용 유틸리티 함수를 추가한다:

```typescript
// packages/agent-framework/src/...
export function readPackageVersion(importMetaUrl: string): string;
```

- `importMetaUrl`을 받아 해당 패키지 위치 기준으로 `package.json`을 탐색
- `candidates` 순회 로직 이동 (outer try-catch 제거, inner만 유지)
- 읽기 실패 시 `'0.0.0'` sentinel 유지 (버전 읽기 실패는 throw 대신 sentinel 반환이 적절)

`agent-cli/src/startup/version.ts`:

```typescript
import { readPackageVersion } from '@robota-sdk/agent-framework';
export const readVersion = () => readPackageVersion(import.meta.url);
```

또는 `version.ts` 파일 자체를 제거하고 호출 지점에서 직접 `readPackageVersion(import.meta.url)` 호출.

## Scope

- `packages/agent-framework/src/` — `readPackageVersion` 추가 및 export
- `packages/agent-cli/src/startup/version.ts` — 삭제 또는 단순 위임으로 교체
- `packages/agent-framework/src/index.ts` — public export 추가

## Test Plan

- `agent-framework` 단위 테스트: 유효한 `importMetaUrl` → 실제 버전 반환
- `agent-framework` 단위 테스트: 경로 오류 시 `'0.0.0'` 반환
- `pnpm --filter @robota-sdk/agent-framework typecheck`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-framework test`

## User Execution Test Scenarios

### Scenario 1: CLI 버전 표시

- Prerequisites: `pnpm build` 완료
- Steps: `robota --version` 또는 `pnpm run cli:dev --version`
- Expected: 현재와 동일한 버전 문자열 출력 (e.g. `3.0.0-beta.65`)
- Evidence: _(to be filled after implementation)_
