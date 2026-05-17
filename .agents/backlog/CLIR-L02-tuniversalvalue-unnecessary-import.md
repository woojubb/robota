---
title: 'CLIR-L02: bin.ts — TUniversalValue catch 타입 선언 제거 및 unknown으로 교체'
status: todo
created: 2026-05-17
priority: low
urgency: later
area: packages/agent-cli
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #L-02

`packages/agent-cli/src/bin.ts:12–13, 33`에서 `@robota-sdk/agent-core`로부터
`TUniversalValue`를 import하고 `.catch()` 핸들러 타입 선언에 사용한다.

```typescript
// bin.ts:12
import type { TUniversalValue } from '@robota-sdk/agent-core';

// bin.ts:33
startCli().catch((err: Error | TUniversalValue) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

## 문제 상세

Promise의 `.catch()` 핸들러는 TypeScript에서 항상 `unknown`이므로
이 타입 선언은 실제 타입 안전성을 제공하지 않는다.
`TUniversalValue` import는 이를 위해서만 존재하므로 불필요한 크로스-패키지 의존성이다.

실제로 핸들러 내부는 `err instanceof Error ? err.message : String(err)`로
올바르게 narrowing하므로 `err: unknown`으로도 완전히 동작한다.

## 권장 조치

```typescript
// 수정 후
startCli().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

`TUniversalValue` import 줄 전체 삭제.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `grep -n "TUniversalValue" packages/agent-cli/src/bin.ts` — 결과 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli build` 통과

## User Execution Test Scenarios

Not applicable — 타입 선언 변경으로 런타임 동작이 동일하다.
`err instanceof Error ? err.message : String(err)` narrowing 로직은 변경되지 않으며,
사용자가 관찰 가능한 제품 동작 변화가 없다. typecheck 통과로 검증한다.
