# New Rules Refactoring

## Status: ready

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

## Phase 1: Critical — 극단적 복잡도/크기 파일 분할

가장 시급한 5개 파일. 단일 파일이 규칙의 3배 이상 초과.

| 파일 | 행수 | Complexity | 조치 |
|------|------|-----------|------|
| agents/execution-service.ts | 1298 | 81 | 모듈 분할 (실행/이력/이벤트) |
| dag-server-core/dag-server-bootstrap.ts | 1214 | 21 | 라우트별 파일 분리 |
| dag-designer/dag-designer-canvas.tsx | 1166 | 16 | 훅/유틸 추출 |
| dag-designer/node-config-panel.tsx | 749 | 38 | 패널 섹션별 컴포넌트 분리 |
| dag-worker/worker-loop-service.ts | 809 | 22 | 루프 로직/상태 관리 분리 |

### Phase 1 추가: 극단 복잡도 함수 분해

| 파일 | Complexity | 조치 |
|------|-----------|------|
| agents/logging-plugin.ts | 96 | switch/if 분기를 handler map으로 |
| agents/performance-plugin.ts | 64 | 메트릭 수집 로직 분리 |
| agents/usage-plugin.ts | 35 | 유사 패턴 |
| playground/playground-context.tsx | 29 | state 로직을 커스텀 훅으로 |
| playground/real-time-tool-block.tsx | 27 | 렌더 로직 분리 |

---

## Phase 2: Type System — type alias 및 ban-types 수정

### 2A. 객체형 type alias → interface 변환 (3건)

| 파일 | 현재 | 변경 |
|------|------|------|
| agents/plugins/limits-plugin.ts:44 | `type TLimitsPluginExecutionResult = {...}` | `interface ILimitsPluginExecutionResult {...}` |
| playground/hooks/use-api-error.ts:4 | `type TApiLikeError = {...}` | `interface IApiLikeError {...}` |
| team/assign-task/relay-assign-task.ts:5 | `type TTemplateEntry = {...}` | `interface ITemplateEntry {...}` |

### 2B. Trivial 1:1 alias 제거/정리 (3건)

| 파일 | 현재 | 판단 |
|------|------|------|
| agents/utils/index.ts:12 | `type TTimerId = ReturnType<typeof setTimeout>` | 유지 — 의미적 이름 부여, 여러 곳에서 사용 |
| agents/schemas/agent-template-schema.ts:75 | `type TValidatedAgentTemplate = z.infer<...>` | 유지 — Zod 추론 결과에 이름 부여는 관례 |
| dag-projection/.../projection-read-model-service.ts:12 | `type TTaskStatusSummary = Record<...>` | 유지 — 도메인 의미 부여 |

### 2C. ban-types (unknown) 수정 (107건, 상위 파일)

| 파일 | 위반 | 조치 |
|------|------|------|
| dag-server-core/dag-server-bootstrap.ts | 18 | 타입 가드 + 구체 타입 |
| remote/http-client.ts | 14 | IResponsePayload 인터페이스 도입 |
| dag-designer/schema-defaults.ts | 12 | TSchemaValue 유니온 타입 |
| dag-designer/node-config-panel.tsx | 9 | Props 타입 구체화 |
| remote-server-core/remote-server-routes.ts | 7 | 요청/응답 타입 정의 |
| team/relay-assign-task.ts | 6 | 결과 타입 구체화 |

---

## Phase 3: null → undefined 마이그레이션

### 3A. 내부 상태 필드 (변경 필요, ~15건)

| 패키지 | 파일 | 패턴 | 조치 |
|--------|------|------|------|
| playground | websocket-client.ts | `ws: WebSocket \| null = null` | `ws?: WebSocket` |
| playground | robota-executor.ts | `currentAgent: Robota \| null = null` | `currentAgent?: Robota` |
| playground | code-executor.ts | `context: ... \| null = null` | `context?: ...` |
| remote | websocket-transport-simple.ts | `ws: WebSocket \| null = null` | `ws?: WebSocket` |
| agents | remote-storage.ts | `timer: TTimerId \| null = null` | `timer?: TTimerId` |
| agents | logger.ts:87 | `level: ... \| null = null` | `level?: ...` |

### 3B. Lookup 반환 타입 (검토 필요, ~25건)

| 패키지 | 메서드 | 현재 | 제안 |
|--------|--------|------|------|
| agents | PluginManager.getPlugin() | `T \| null` | `T \| undefined` |
| agents | ModuleTypeRegistry.getType() | `... \| null` | `... \| undefined` |
| agents | ModuleRegistry.getModule() | `... \| null` | `... \| undefined` |
| playground | ProjectManager 조회 메서드들 | `... \| null` | `... \| undefined` |

### 3C. API 경계 null (유지)

provider.ts, messages.ts, api-types.ts 등 JSON 계약의 null은 변경하지 않음.

---

## Phase 4: Magic Numbers 상수화

437건. 패키지별로 상수 파일 생성.

| 패키지 | 위반 수 | 전략 |
|--------|--------|------|
| playground | 162 | `src/constants/` 디렉토리에 도메인별 상수 |
| agents | 107 | 플러그인별 상수 파일 (limits, timeout 등) |
| dag-server-core | 67 | HTTP 상태 코드, 포트, 타임아웃 상수화 |
| remote | 32 | 프로토콜 상수 (포트, 타임아웃, 재시도) |
| dag-designer | 28 | UI 상수 (크기, 간격, 애니메이션) |
| 나머지 | 41 | 각 패키지 내 constants.ts |

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

- [ ] complexity: 52 → 0 (error 격상)
- [ ] max-lines: 69 → 0 (error 격상)
- [ ] max-lines-per-function: 146 → 0 (error 격상)
- [ ] no-magic-numbers: 437 → 0 (error 격상)
- [ ] ban-types: 107 → 0
- [ ] type alias 위반: 8 → 0
- [ ] 내부 null: ~40 → 0
