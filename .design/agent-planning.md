# Robota SDK 기반 Agentic AI 플래닝 설계 문서

## 개요

이 문서는 Robota SDK를 기반으로 한 Agentic AI 시스템에서 플래너(Planner)들을 어떻게 설계하고 조합할 것인지를 설명한다. 시스템은 다양한 플래닝 전략을 개별 패키지로 분리하여 설계하고, 이를 하나의 매니저에서 조합해 실행 가능한 구조를 목표로 한다.

**현재 상황**: `@robota-sdk/team` 패키지가 CAMEL 기법과 유사하게 구현되어 있으며, 이를 체계적인 플래닝 아키텍처로 발전시킬 예정이다.

---

## 핵심 구성 요소

### 1. **AbstractPlanner (추상 플래너 클래스)**

```typescript
// packages/planning/src/abstracts/base-planner.ts
export abstract class AbstractPlanner {
  abstract name(): string;
  abstract plan(input: PlanInput): Promise<PlanStep[]>;
  abstract executeStep(step: PlanStep): Promise<PlanResult>;
  
  // 선택적 구현
  async finalize(results: PlanResult[]): Promise<PlanResult> {
    return results[results.length - 1];
  }
}
```

### 2. **PlannerManager**

```typescript
// packages/planning/src/managers/planner-manager.ts
export class PlannerManager {
  register(planner: AbstractPlanner): void;
  runSequential(plannerNames: string[], input: PlanInput): Promise<PlanResult[]>;
  runParallel(plannerNames: string[], input: PlanInput): Promise<PlanResult[]>;
  runWithFallback(plannerNames: string[], input: PlanInput): Promise<PlanResult>;
}
```

### 3. **Robota Agent 통합**

```typescript
// packages/agents/src/agents/robota.ts (기존 확장)
export class Robota extends BaseAgent {
  private plannerManager?: PlannerManager;
  
  // 플래닝 기반 실행 메서드 추가
  async runWithPlanning(input: string, strategy?: string[]): Promise<string>;
}
```

### 4. **플래너 전략 패키지들**

현재 및 계획된 패키지 구조:
- `@robota-sdk/planning` - 코어 플래닝 시스템
- `@robota-sdk/planner-react` - ReAct 전략
- `@robota-sdk/planner-camel` - 현재 team 기능을 발전시킨 CAMEL 구현체
- `@robota-sdk/planner-reflection` - Reflection 전략
- `@robota-sdk/planner-plan-execute` - Plan-and-Execute 전략

---

## 주요 플래닝 기법 목록

| 기법명                             | 설명                                                 | 특징                   | 패키지명 (계획)               |
| ------------------------------- | -------------------------------------------------- | -------------------- | ------------------------ |
| **ReAct** (Reason + Act)        | Thought → Action → Observation 순으로 사고 및 실행을 번갈아 수행 | 유연하고 도구 기반 추론에 강함    | `@robota-sdk/planner-react` |
| **Plan-and-Execute**            | 전체 계획 수립 후 순차적으로 실행                                | 구조화 쉬우며 장기 계획에 적합    | `@robota-sdk/planner-plan-execute` |
| **Reflection**                  | 결과에 대한 평가 및 자기 피드백을 통해 수정                          | 오류 자가 수정 루프에 효과적     | `@robota-sdk/planner-reflection` |
| **Chain of Thought (CoT)**      | 추론 과정을 단계별로 명시적으로 표현                               | 수학적/논리적 문제에 유리       | `@robota-sdk/planner-cot` |
| **Tool-augmented (MRKL)**       | 외부 도구 호출을 포함한 실행 전략                                | 정확도 향상 및 모듈 기반 처리 가능 | `@robota-sdk/planner-mrkl` |
| **Hierarchical Planning (HTN)** | 목표를 하위 목표로 분해하여 재귀적으로 계획                           | 복잡한 시나리오 처리에 적합      | `@robota-sdk/planner-htn` |
| **AutoGPT 스타일**                 | 목표 기반 반복 루프 실행 (계획 + 실행 + 리플렉션)                    | 장기적인 자율 실행에 유리       | `@robota-sdk/planner-autogpt` |
| **CAMEL** ⭐                     | 역할 기반 다중 에이전트 커뮤니케이션 구조                            | 멀티 에이전트 협업 처리 가능     | `@robota-sdk/planner-camel` |
| **Toolformer**                  | 도구 사용 여부를 LLM이 학습 및 결정                             | 도구 호출 조건 최적화         | `@robota-sdk/planner-toolformer` |
| **MetaGPT**                     | 소프트웨어 팀의 역할을 시뮬레이션하여 구조적 작업 분할                     | 코딩, 설계, 분업형 태스크에 강함  | `@robota-sdk/planner-metagpt` |

⭐ **현재 우선순위**: CAMEL 패키지 구현 (기존 team 라이브러리 재구성)

---

## 플래너 조합 실행 예시

1. 사용자 입력: "웹사이트 리디자인 프로젝트를 진행해줘"
2. Robota가 이를 해석해 PlannerManager에 요청
3. Manager는 CAMELPlanner (팀 구성) → ReActPlanner (개별 작업) → ReflectionPlanner (검토) 순으로 실행
4. 최종 결과를 Robota가 사용자에게 반환

---

## 현재 Team 라이브러리 분석

### 기존 구조
```typescript
// packages/team/src/team-container.ts
export class TeamContainer {
  createAgent(config: AgentConfig): string;
  assignTask(params: AssignTaskParams): Promise<AssignTaskResult>;
  // ... 다중 에이전트 관리 기능
}
```

### CAMEL 패턴 관점에서의 분석
- ✅ **역할 기반 에이전트**: 이미 구현됨
- ✅ **태스크 할당**: assignTask 메서드로 구현됨
- ✅ **결과 수집**: AssignTaskResult로 구현됨
- 🔄 **개선 필요**: 플래닝 프로토콜과의 통합

---

## 작업 계획 및 체크리스트

### Phase 1: 플래닝 코어 시스템 구축
- [ ] `packages/planning` 패키지 생성
  - [ ] `src/abstracts/base-planner.ts` - AbstractPlanner 클래스
  - [ ] `src/interfaces/plan.ts` - PlanInput, PlanStep, PlanResult 타입 정의
  - [ ] `src/managers/planner-manager.ts` - PlannerManager 클래스
  - [ ] `src/index.ts` - 패키지 exports
- [ ] Planning 패키지 TypeScript 설정 및 빌드 구성
- [ ] Planning 패키지 테스트 작성
- [ ] Documentation 작성

### Phase 2: Robota Agent에 플래닝 통합
- [ ] `packages/agents` 패키지에 planning 의존성 추가
- [ ] `src/agents/robota.ts`에 PlannerManager 통합
  - [ ] `runWithPlanning()` 메서드 추가
  - [ ] 플래너 등록/해제 메서드 추가
  - [ ] 기존 `run()` 메서드와의 호환성 유지
- [ ] Agent Factory에서 플래너 동적 로딩 지원
- [ ] 통합 테스트 작성

### Phase 3: CAMEL 플래너 구현 (기존 Team 리팩토링)
- [ ] `packages/planner-camel` 패키지 생성
- [ ] 기존 `packages/team` 코드 분석 및 마이그레이션 계획 수립
- [ ] CAMEL 플래너 구현
  - [ ] `src/camel-planner.ts` - AbstractPlanner 상속
  - [ ] `src/role-based-agent.ts` - 역할 기반 에이전트 관리
  - [ ] `src/communication-protocol.ts` - 에이전트 간 커뮤니케이션
  - [ ] `src/task-coordinator.ts` - 태스크 분배 및 조정
- [ ] 기존 TeamContainer API와의 브릿지 구현
- [ ] CAMEL 플래너 테스트 작성

### Phase 4: 기존 Team 패키지 업데이트
- [ ] `packages/team`을 CAMEL 플래너 기반으로 재구성
- [ ] 기존 API 호환성 유지하면서 내부적으로 CAMEL 플래너 사용
- [ ] `TeamContainer`를 `CAMELPlanner`의 래퍼로 변경
- [ ] 기존 예제 코드들이 여전히 작동하는지 확인
- [ ] Migration guide 작성

### Phase 5: 추가 플래너 구현 (선택사항)
- [ ] `packages/planner-react` - ReAct 전략 구현
- [ ] `packages/planner-reflection` - Reflection 전략 구현
- [ ] `packages/planner-plan-execute` - Plan-and-Execute 전략 구현
- [ ] 플래너 조합 예제 작성

### Phase 6: 고급 기능 및 최적화
- [ ] PlannerSelector - LLM 기반 플래너 자동 선택
- [ ] PlannerComposition - 복합 실행 전략 (병렬, 조건분기, fallback)
- [ ] PlannerContext - 플래너 간 상태 공유
- [ ] PlanStepLog - 실행 히스토리 추적
- [ ] 성능 최적화 및 메모리 관리

### Phase 7: 문서화 및 예제
- [ ] 전체 플래닝 시스템 가이드 작성
- [ ] 각 플래너별 사용법 문서
- [ ] 실제 사용 시나리오별 예제 코드
- [ ] 플래너 개발자를 위한 가이드
- [ ] API 레퍼런스 업데이트

---

## 플래너 선택 전략

### A. 사전 고정 방식
```typescript
await robota.runWithPlanning(input, ['camel', 'reflection']);
```

### B. LLM 기반 동적 선택
```typescript
await robota.runWithPlanning(input); // LLM이 자동으로 플래너 선택
```

### C. 설정 기반 선택
```typescript
const robota = new Robota({
  // ... 기존 설정
  defaultPlanners: ['camel'],
  plannerSelection: 'auto' // 'fixed' | 'auto' | 'hybrid'
});
```

---

## 구조적 장점

* ✅ **전략 독립성 보장**: 각 플래너는 독립적인 패키지
* ✅ **기존 코드 호환성**: 점진적 마이그레이션 가능
* ✅ **외부 개발자 참여**: 플래너 생태계 확장 가능
* ✅ **실행 플로우 유연성**: 다양한 조합 전략 지원
* ✅ **디버깅 및 재현**: 각 플래닝 단계 추적 가능
* ✅ **확장성**: 새로운 플래닝 기법 쉽게 추가

---

## 예상 도전과제 및 해결방안

### 1. 기존 Team API 호환성
**문제**: 기존 사용자들이 TeamContainer API에 의존
**해결**: 브릿지 패턴으로 기존 API 유지하면서 내부적으로 CAMEL 플래너 사용

### 2. 플래너 간 상태 공유
**문제**: 서로 다른 플래너가 실행될 때 컨텍스트 공유 필요
**해결**: PlannerContext 객체를 통한 상태 관리

### 3. 성능 최적화
**문제**: 여러 플래너 조합 시 지연 시간 증가
**해결**: 병렬 실행, 캐싱, 지연 로딩 등의 최적화 기법 적용

---

## 다음 단계

1. **즉시 시작**: Phase 1 (플래닝 코어 시스템) 구축
2. **우선순위**: CAMEL 플래너 구현을 통한 기존 team 기능 향상
3. **장기 목표**: 다양한 플래닝 전략의 생태계 구축

이 설계를 통해 Robota SDK는 단순한 대화형 AI를 넘어 복잡한 작업을 체계적으로 계획하고 실행할 수 있는 진정한 Agentic AI 플랫폼으로 발전할 것이다.
