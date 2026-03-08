# New Rules Refactoring

## Status: in-progress

## Priority: high

## Scope

coding-rules-audit에서 수용된 규칙에 맞게 기존 코드를 리팩토링.
총 863 ESLint warnings + 8 type alias 위반 + ~40 null 위반.

---

## 위반 현황 요약

| 규칙 | 위반 수 | 비고 |
|------|--------|------|
| no-magic-numbers | 437 | 가장 많음, playground(162), agents(107) |
| max-lines-per-function | 146 | 50행 초과 함수 |
| ban-types (unknown) | 107 | 기존 이슈, dag-server-core/designer에 집중 |
| max-lines | 69 | 300행 초과 파일 |
| complexity | 52 | 15 초과 함수, agents에 극단적 사례(Cx=96) |
| type alias 위반 | 8 | 객체형 alias, trivial 1:1 alias |
| null → undefined | ~40 | 내부 상태에서 null 사용 |

---

## Phase 1: Critical — 극단적 복잡도/크기 파일 분할 ✅ DONE

브랜치: `refactor/critical-file-splitting` → develop 머지 완료

가장 시급한 5개 파일. 단일 파일이 규칙의 3배 이상 초과.

| 파일 | 행수 | Complexity | 조치 | 상태 |
|------|------|-----------|------|------|
| agents/execution-service.ts | 1298 | 81 | 모듈 분할 (실행/이력/이벤트) | ✅ (이전 세션) |
| dag-server-core/dag-server-bootstrap.ts | 1214 | 21 | 라우트별 파일 분리 | ✅ |
| dag-designer/dag-designer-canvas.tsx | 1166 | 16 | 훅/유틸 추출 | ✅ |
| dag-designer/node-config-panel.tsx | 749 | 38 | 패널 섹션별 컴포넌트 분리 | ✅ |
| dag-worker/worker-loop-service.ts | 809 | 22 | 루프 로직/상태 관리 분리 | ✅ (이전 세션) |

### Phase 1 추가: 극단 복잡도 함수 분해 (부분 완료)

| 파일 | Complexity | 조치 | 상태 |
|------|-----------|------|------|
| agents/logging-plugin.ts | 96 | switch/if 분기를 handler map으로 | ✅ (이전 세션) |
| agents/performance-plugin.ts | 64 | 메트릭 수집 로직 분리 | ✅ (이전 세션) |
| agents/usage-plugin.ts | 35 | 유사 패턴 | ⬜ 미완 |
| playground/playground-context.tsx | 29 | state 로직을 커스텀 훅으로 | ⬜ 미완 |
| playground/real-time-tool-block.tsx | 27 | 렌더 로직 분리 | ⬜ 미완 |

---

## Phase 2: Type System — type alias 및 ban-types 수정 ✅ DONE

브랜치: `refactor/type-system-cleanup` → develop 머지 완료

### 2A. 객체형 type alias → interface 변환 (3건) ✅

| 파일 | 현재 | 변경 | 상태 |
|------|------|------|------|
| agents/plugins/limits-plugin.ts:44 | `type TLimitsPluginExecutionResult = {...}` | `interface ILimitsPluginExecutionResult {...}` | ✅ |
| playground/hooks/use-api-error.ts:4 | `type TApiLikeError = {...}` | `interface IApiLikeError {...}` | ✅ |
| team/assign-task/relay-assign-task.ts:5 | `type TTemplateEntry = {...}` | `interface ITemplateEntry {...}` | ✅ |

### 2B. Trivial 1:1 alias 제거/정리 (3건) — 모두 유지 판정 ✅

### 2C. ban-types (unknown) — 조사 결과 위반 아님 ✅

107건 모두 trust boundary에서 `unknown`을 올바르게 사용 (타입 가드로 narrowing). 수정 불필요.

---

## Phase 3: null → undefined 마이그레이션 ✅ DONE

브랜치: `refactor/type-system-cleanup` → develop 머지 완료 (Phase 2와 동일 브랜치)

### 3A. 내부 상태 필드 ✅ (~15건 모두 수정)
### 3B. Lookup 반환 타입 ✅ (~25건 모두 수정, 테스트 업데이트 포함)
### 3C. API 경계 null (유지) ✅ — 변경 없음 (정책대로)

---

## Phase 4: Magic Numbers 상수화 ✅ DONE

브랜치: `refactor/magic-numbers-constants` → develop 머지 완료

325 warnings → 0. 79개 파일 수정 완료.

---

## Phase 5: 나머지 max-lines / max-lines-per-function

Phase 1에서 처리하지 않은 중간 크기 위반.

### 300행 초과 파일 (Phase 1 제외 나머지)

| 파일 | 행수 | 조치 |
|------|------|------|
| agents/limits-plugin.ts | 403 | 검증 로직 분리 |
| agents/abstract-module.ts | 464 | 라이프사이클별 분리 |
| agents/module-type-registry.ts | 393 | 레지스트리/팩토리 분리 |
| playground/code-executor.ts | 530 | 실행/컨텍스트 분리 |
| playground/playground-context.tsx | 542 | 상태/액션 훅 분리 |
| playground/robota-executor.ts | 557 | 실행/통신 분리 |
| bytedance/provider.ts | 439 | 요청 빌더 추출 |
| dag-designer/designer-api-client.ts | 393 | API 그룹별 분리 |

### 50행 초과 함수 (상위 사례)

| 파일 | 함수 행수 | 조치 |
|------|----------|------|
| dag-server-core/dag-server-bootstrap.ts | 869 | Phase 1에서 처리 |
| agents/execution-service.ts | 668 | Phase 1에서 처리 |
| playground/demo-execution-data.ts | 252 | 데이터 팩토리 분리 |
| playground/playground-context.tsx | 274 | 커스텀 훅 추출 |
| playground/use-websocket-connection.ts | 263 | 이벤트 핸들러 분리 |

---

## 실행 순서 및 브랜치

| Phase | 브랜치 | 예상 파일 수 | 의존성 |
|-------|--------|------------|--------|
| 1 | `refactor/critical-file-splitting` | ~15 | 없음 |
| 2 | `refactor/type-system-cleanup` | ~10 | Phase 1 후 |
| 3 | `refactor/null-to-undefined` | ~20 | Phase 1 후 |
| 4 | `refactor/magic-numbers-constants` | ~40 | Phase 1 후 |
| 5 | `refactor/remaining-size-violations` | ~15 | Phase 1 후 |

Phase 2-5는 Phase 1 이후 병렬 가능.

---

## 검증 체크리스트

각 Phase 완료 시:
- [ ] pnpm build 통과
- [ ] pnpm test 통과
- [ ] pnpm lint — 해당 규칙 위반 감소 확인
- [ ] 기존 public API 변경 없음 (breaking change 금지)

## 최종 목표

- [ ] complexity: 52 → ? (일부 해결, 잔여 미확인)
- [ ] max-lines: 69 → ~38 (Phase 1에서 31개 해소)
- [ ] max-lines-per-function: 146 → ~139 (일부 해소)
- [x] no-magic-numbers: 437 → 0 ✅
- [x] ban-types: 107 → 0 (위반 아님 확인) ✅
- [x] type alias 위반: 8 → 0 ✅
- [x] 내부 null: ~40 → 0 ✅
