# 하네스 시스템 종합 검토 및 개선 계획

> 날짜: 2026-03-08
> 범위: 하네스 필수 요소 검증, rules/skills 정합성, 패키지 스펙 현황, agents 패키지 리팩토링 계획

---

## 1. 하네스 시스템 현재 상태

### 1.1 구현 완료된 요소

| 구성 요소 | 스크립트 | 상태 |
|----------|---------|------|
| Consistency Scan | `scan-consistency.mjs` | 통과 |
| Spec Coverage Audit | `audit-spec-coverage.mjs` | 100% |
| Docs Structure Validation | `validate-package-docs-structure.mjs` | 통과 |
| Change Verification | `verify-change.mjs` | 구현됨 |
| Change Review | `review-change.mjs` | 구현됨 |
| Change Recording | `record-change.mjs` | 구현됨 |
| Scenario Owner Map | `scenario-owner-map.mjs` | 구현됨 |
| Owner Scenario Recording | `record-owner-scenario.mjs` | 구현됨 |
| Self-Check | `self-check.mjs` | 통과 |

### 1.2 미구현 요소 (전면 하네스 계획 대비)

| Workstream | 요소 | 우선순위 |
|-----------|------|---------|
| WS4. Observability | `collect-run-context.mjs` | 중간 |
| WS4. Observability | strict policy 로그 추출기 | 중간 |
| WS4. Observability | ownerPath 흐름 요약기 | 중간 |
| WS7. Cleanup | `harness:cleanup` | 높음 |
| WS7. Cleanup | drift scan 리포트 | 높음 |
| WS8. App Boot | `harness:bootstrap -- web` | 낮음 |
| WS8. App Boot | `harness:bootstrap -- api-server` | 낮음 |
| WS9. Evaluation | representative eval set | 낮음 |
| WS5. Policy Enforcement | `dependency-direction-check` | 높음 |
| WS5. Policy Enforcement | `boundary-validation-check` | 중간 |
| WS5. Policy Enforcement | `agent-identity-check` | 낮음 |
| WS5. Policy Enforcement | `import-policy-check` | 중간 |

### 1.3 하네스 보강 필수 항목

#### A. `harness:cleanup` 도입 (우선)

저장소 엔트로피 정리를 자동화하는 명령이 아직 없다.

필요 기능:
- 스테일 `.design/tmp/` 문서 감지
- 죽은 skill anchor 탐지
- 미사용 예제/코드 drift 감지
- 중복 타입 선언 탐지 (기존 `ssot-duplicate-declarations` 활용)

#### B. `dependency-direction-check` 도입 (우선)

DAG 패키지의 의존 방향 위반을 기계적으로 검출하는 검사기가 아직 없다.
현재는 사람 리뷰에 의존한다.

#### C. 하네스 report 산출물 표준화 (CURRENT-TASKS에 이미 등재)

review/verify 결과를 비교 가능한 JSON schema로 고정해야 한다.

---

## 2. Rules/Skills 정합성 결과

### 2.1 실제 충돌: 0건

이전 `.design/tmp/` 분석 문서에서 제기된 충돌 3건은 모두 거짓 양성이었다.
- `unknown` 정책: AGENTS.md가 trust boundary에서 명시적으로 허용
- 의존 방향: 올바르게 기술됨
- terminal state: explicit policy gate 조건 명시됨

### 2.2 관리상 갭

| 항목 | 상태 | 조치 |
|------|------|------|
| AGENTS.md Skills Reference에 미등재 skill 2개 | `scenario-guard-checklist`, `verification-guard` | 삭제 또는 등재 (이미 통합됨) |
| `Path-Only` 미정의 용어 | `.design/tmp/` 에만 존재 | tmp 정리 시 삭제 |
| Agent Identity 규칙의 대응 skill 없음 | harness-governance에 포함 필요 | scan에 용어 검사 추가 |
| Styling 규칙의 대응 skill 불완전 | tailwind-truncation은 범위 좁음 | 필요 시 확장 |

### 2.3 중복 영역 4개

1. **아키텍처/경계/DI**: 5개 skill이 동일 원칙 반복 → 역할 재정의 필요
2. **캐싱**: execution-caching + execution-cache-ops → 이미 통합 완료
3. **시나리오 검증**: 3개 skill → scenario-verification-harness로 통합 완료
4. **문서 언어**: 3개 skill → repo-writing으로 통합 완료

### 2.4 결론

정합성: 94%. 기능적 충돌 없음. 관리상 정리 5건.

---

## 3. 패키지 스펙 문서 현황

### 3.1 SPEC.md 보유율

- 전체: 31/31 워크스페이스 보유 (100%) - harness:scan:specs 기준
- docs/README.md → SPEC.md 참조: 100%

### 3.2 SPEC.md 품질 문제

대부분의 SPEC.md가 2~5줄의 최소 내용만 포함한다.
보편적인 개발 방법론 관점에서 다음이 누락되어 있다:

| 누락 항목 | 설명 | 관련 방법론 |
|----------|------|-----------|
| Architecture Overview | 레이어 구조, 핵심 컴포넌트 | Clean Architecture, Hexagonal |
| Type Ownership Map | 타입 SSOT 소유권 | DDD Bounded Context |
| Public API Surface | 공개 인터페이스 목록 | API-First Design |
| Extension Points | 확장 포인트 정의 | Open-Closed Principle |
| Error Taxonomy | 에러 코드 분류 | Effect-Style Error Modeling |
| State Lifecycle | 상태 전이 규칙 | State Machine Design |
| Dependency Contract | 의존 관계 계약 | Dependency Inversion |
| Test Strategy | 테스트 레이어 정의 | Testing Pyramid |

### 3.3 Scenario 커버리지

- 시나리오 검증 보유: 6/31 (19%)
- 대부분 패키지에 examples/ 없음 → harness 규칙상 scenario:verify 불필요
- 핵심 패키지(agents, team, openai, google, bytedance, sessions)는 보유

---

## 4. Agents 패키지 심층 분석

### 4.1 아키텍처 평가

| 영역 | 평가 | 비고 |
|------|------|------|
| 타입 안전성 | 매우 우수 | `any` 0건, strict 준수 |
| DI 패턴 | 모범적 | Null Object, 생성자 주입, 싱글톤 0 |
| 이벤트 시스템 | 우수 | 계층화 설계, ownerPath 지원 |
| 플러그인 시스템 | 우수 | 10개 내장, 라이프사이클 훅 |
| 도구 시스템 | 견고 | Zod 스키마 검증, 4종 도구 타입 |
| Fallback 정책 | 완벽 준수 | silent fallback 0건 |
| 로깅 정책 | 완벽 준수 | console.* 0건, ILogger 주입 |
| 에이전트 용어 | 완벽 준수 | 금지 용어 0건 |

### 4.2 개선 필요 영역

#### 높은 우선순위

**A. 테스트 커버리지: 6% → 60% 목표**

현재 8개 테스트 파일 / 125개 소스 파일.

| 미테스트 영역 | 파일 수 | 우선순위 |
|-------------|--------|---------|
| plugins/ (logging, usage, performance, webhook 등) | ~30 | 높음 |
| tools/implementations/ (function-tool, mcp-tool 등) | ~10 | 높음 |
| utils/ (errors, validation, message-converter) | ~6 | 중간 |
| abstracts/ | ~10 | 중간 |
| services/ (tool-execution, task-events) | ~4 | 높음 |

**B. SPEC.md 보강**

현재 5줄. 다음을 포함하도록 확장:

1. Architecture Overview (레이어 구조)
2. Type Ownership Map (TUniversalMessage, TUniversalValue SSOT)
3. Public API Surface (Robota, AbstractPlugin, AbstractTool 등)
4. Plugin System Contract (라이프사이클 훅, 우선순위, 충돌 정책)
5. Event Architecture (ownerPath, 이벤트 네이밍, 계층 추적)
6. Extension Points (AbstractPlugin, AbstractTool, AbstractAIProvider)
7. Error Taxonomy (ConfigurationError, ToolExecutionError 등)
8. Test Strategy (unit, integration, scenario)

#### 중간 우선순위

**C. 실행 캐싱 미구현**

AGENTS.md 규칙:
- LLM 호출 전 캐시 확인 필수
- 성공 결과 캐시 저장 필수
- 동등 실행 반복 금지

현재 ExecutionService에 캐싱 로직이 없다.
별도 CacheLayer 또는 ExecutionService 내 캐시 통합이 필요하다.

**D. 플러그인 실행 순서 검증**

PluginPriority enum은 있으나 실제 실행 순서 검증이 없다.
충돌하는 플러그인(예: 로깅 플러그인 2개) 감지 로직도 없다.

**E. 이벤트 계층 추적 강화**

ownerPath가 있으나 depth, spanId 등 분산 추적 호환 필드가 누락.

---

## 5. 추천 개발 방법론 및 skill 추가

### 5.1 현재 skill에서 커버하지 못하는 방법론

| 방법론 | 현재 커버리지 | 제안 |
|--------|------------|------|
| **Testing Pyramid / Test Strategy** | vitest-testing-strategy 있음 | agents 패키지에 적용 가이드 보강 |
| **API-First Design** | semver-api-surface 부분 커버 | 패키지별 public API surface 관리 skill 필요 |
| **Observability Engineering** | 없음 | 신규 skill 제안 |
| **Package Spec Writing** | 없음 | 신규 skill 제안 |
| **Refactoring Workflow** | repo-change-loop 부분 커버 | 리팩토링 특화 skill 제안 |

### 5.2 신규 skill 제안

#### A. `spec-writing-standard` (신규)

목적: 패키지 SPEC.md 작성 표준과 품질 게이트 정의

포함:
- SPEC.md 필수 섹션 목록
- 섹션별 최소 내용 기준
- SPEC.md와 코드의 drift 감지 방법
- harness:scan:specs과의 연결

#### B. `observability-harness` (신규)

목적: 이벤트 흐름, 에러 추적, 실행 맥락 관찰 표준

포함:
- ownerPath 기반 이벤트 추적 워크플로
- strict policy 에러 분류 및 수집
- 구조적 로그 수집 기준
- 실행 실패 재현용 최소 입력 저장

#### C. `refactoring-workflow` (신규)

목적: 안전한 리팩토링 루프 정의

포함:
- 영향 범위 식별 (harness:review 활용)
- 기존 테스트 통과 확인 → 리팩토링 → 재검증
- API surface 변경 시 semver 판단
- 하위 호환성 검증 체크리스트

---

## 6. 규칙 등록 제안

에이전트가 자연스럽게 이런 보강을 계속하도록 다음을 AGENTS.md에 추가할 것을 제안한다.

### 6.1 Owner Knowledge Policy 보강

```
### Spec Quality Gate

Each workspace SPEC.md must include at minimum:
- Architecture overview with layer structure
- Type ownership map for SSOT types
- Public API surface list
- Extension points
- Error taxonomy
- Test strategy summary

The `harness:scan:specs` command should verify these sections exist.
```

### 6.2 Continuous Improvement Rule

```
### Continuous Improvement

When modifying a package, agents should:
- Check if SPEC.md reflects the current architecture
- Identify missing test coverage for touched code paths
- Update type ownership documentation if new SSOT types are introduced
- Flag SPEC.md drift for packages where implementation diverges from spec
```

---

## 7. Agents 패키지 리팩토링 계획

### Phase 1: SPEC.md 보강 (즉시)

SPEC.md를 다음 구조로 확장:
- Scope (기존 유지)
- Architecture Overview
- Layer Structure (Robota → ExecutionService → Managers → Services → Plugins)
- Type Ownership
- Public API Surface
- Plugin Contract
- Event Architecture
- Extension Points
- Error Types
- Boundaries
- Test Strategy

### Phase 2: 테스트 커버리지 확대 (1-2주)

우선순위:
1. 플러그인 테스트 7건 추가 (logging, usage, performance, webhook, limits, error-handling, conversation-history)
2. 도구 구현 테스트 4건 추가 (function-tool, mcp-tool, openapi-tool, relay-mcp-tool)
3. 서비스 에지 케이스 3건 추가 (tool-execution, task-events, user-events)

### Phase 3: 실행 캐싱 도입 (2-3주)

- ExecutionService에 캐시 레이어 추가
- 캐시 키 생성 전략 정의
- 캐시 무효화 정책 정의
- 캐시 무결성 검증 실패 시 즉시 중단

### Phase 4: 플러그인 시스템 강화 (3-4주)

- 플러그인 실행 순서 검증 로직 추가
- 플러그인 충돌 감지 (동일 타입 중복 등록)
- 플러그인 의존성 선언 메커니즘

### Phase 5: 이벤트 시스템 고도화 (4주+)

- 이벤트 계층 추적 필드 추가 (depth, spanId)
- 이벤트 히스토리 분석 도구
- ownerPath 기반 실행 흐름 시각화

---

## 8. 즉시 실행 항목 요약

| 번호 | 항목 | 범위 |
|------|------|------|
| 1 | agents SPEC.md 보강 | packages/agents/docs/SPEC.md |
| 2 | `spec-writing-standard` skill 생성 | .agents/skills/spec-writing-standard/ |
| 3 | AGENTS.md에 Spec Quality Gate 규칙 추가 | AGENTS.md |
| 4 | AGENTS.md에 Continuous Improvement 규칙 추가 | AGENTS.md |
| 5 | `.design/tmp/` 스테일 문서 정리 안내 | CURRENT-TASKS.md 업데이트 |
| 6 | `harness:cleanup` 스크립트 초안 | scripts/harness/cleanup-drift.mjs |
| 7 | `dependency-direction-check` 스크립트 초안 | scripts/harness/check-dependency-direction.mjs |
