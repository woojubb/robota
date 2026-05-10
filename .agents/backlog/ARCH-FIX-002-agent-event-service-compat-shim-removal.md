---
title: 'ARCH-FIX-002: agent-event-service compat shim 소비자 마이그레이션 및 패키지 삭제'
status: todo
created: 2026-05-10
priority: critical
urgency: next
area: architecture
related: [V-DEP-004, V-CON-001]
---

## Problem

`packages/agent-event-service`는 `project-structure.md`에 "Compatibility re-export package"로 공식 명시된 pass-through re-export 패키지다. 이는 `common-mistakes.md` #4에서 명시적으로 금지된 패턴이다.

```
// project-structure.md
agent-event-service/  — Compatibility re-export package for event service APIs
```

현재 `agent-team`이 이 compat shim 경로를 소비 중이다. 미배포 프로젝트에서 backward compatibility shim은 존재 이유가 없다. 또한 `cross-cutting-contracts.md`가 이 shim을 영구 계약 항목으로 등재해 아키텍처 맵 자체를 오염시키고 있다.

## Solution

1. `agent-event-service`의 소비자를 전수 조사한다(`rg '@robota-sdk/agent-event-service'`).
2. 각 소비자의 임포트를 원소유자 패키지(실제 이벤트 서비스 구현체)에서 직접 임포트하도록 교체한다.
3. 모든 소비자 마이그레이션 후 `packages/agent-event-service` 패키지를 삭제한다.
4. `project-structure.md`에서 해당 항목 제거, `cross-cutting-contracts.md`에서 해당 항목 제거 또는 원소유자로 갱신한다.

## Test Plan

- `rg '@robota-sdk/agent-event-service'` 결과 0건 (패키지 자체 제외)
- `pnpm typecheck` 전체 통과
- `pnpm build` 전체 통과
- `pnpm test` 전체 통과
- `packages/agent-event-service` 디렉토리 부재 확인

## User Execution Test Scenarios

### 시나리오: agent-team 기능이 마이그레이션 후에도 정상 동작하는지 확인

**전제 조건**: Node.js 22+, pnpm 빌드 완료

**실행 단계**:

```bash
pnpm build
pnpm --filter @robota-sdk/agent-team test
```

**기대 결과**: 모든 테스트 통과, agent-event-service 임포트 없음.

**증거**: (구현 후 기록)
