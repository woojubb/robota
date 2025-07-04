# Planning 시스템 구현 로드맵

이 문서는 Robota SDK Planning 시스템을 구현하기 위한 체계적인 작업 계획과 체크리스트를 제공합니다.

## 개요

### 목표
- `@robota-sdk/planning` 패키지 구현
- 기존 `@robota-sdk/team`과 차별화된 전략적 플래닝 시스템 구축
- 다양한 플래닝 알고리즘을 조합할 수 있는 확장 가능한 아키텍처
- **AgentFactory 확장 전략** 통합 구현

### 현재 상황
- ✅ BaseAgent, AgentFactory, Team 시스템 완성
- ✅ 타입 안전한 플러그인 시스템 구축
- ✅ AgentFactory 확장 전략 설계 완료
- ✅ 도구 주입 전략 설계 완료
- 🔄 Planning 시스템 신규 개발 필요

### 사용자 규칙 준수 항목
- ✅ Semantic Type Naming Standards 적용
- ✅ Provider 불가지론 준수 (특정 AI Provider에 의존하지 않음)
- ✅ 타입 매개변수 명명 규칙 준수
- ✅ Zero any/unknown 정책 유지

---

## Phase 1: AgentFactory 확장 구현 (우선순위: 최고)

### 1.1 AgentFactory 확장 타입 시스템
- [ ] `packages/agents/src/interfaces/agent-factory-expansion.ts` 파일 생성
  - [ ] `AgentCreationConditions` 인터페이스 정의
  - [ ] `PlanningExecutionContext` 인터페이스 정의  
  - [ ] `AgentCreationSpec` 인터페이스 정의
  - [ ] `AgentTemplateVariation` 인터페이스 정의
  - [ ] Semantic type naming 규칙 완전 준수
    ```typescript
    // Planning 컨텍스트 메타데이터 타입
    type PlanningContextMetadata = Record<string, string | number | boolean | Date>;
    
    // 에이전트 생성 설정값 타입
    type AgentCreationConfigValue = string | number | boolean;
    
    // 에이전트 템플릿 검색 조건
    type AgentTemplateCriteria = Record<string, string | number | boolean>;
    ```

### 1.2 AgentFactory 조건부 생성 시스템 구현
- [ ] `packages/agents/src/agents/agent-factory.ts` 확장
  - [ ] `createWithConditions()` 메서드 구현
    - [ ] 조건 기반 최적 템플릿 선택 로직
    - [ ] 동적 설정 생성 로직
    - [ ] 매칭 점수 계산 알고리즘
  - [ ] `createFromPrompt()` 메서드 구현
    - [ ] LLM 기반 프롬프트 의도 분석
    - [ ] 동적 시스템 메시지 생성
    - [ ] Provider 불가지론적 AI 모델 선택
  - [ ] `createBatch()` 메서드 구현
    - [ ] 병렬 생성 최적화
    - [ ] 리소스 제약 고려한 동시성 제어
    - [ ] 생성 후 최적화 처리

### 1.3 템플릿 조작 시스템 구현
- [ ] `packages/agents/src/managers/template-manipulation.ts` 파일 생성
  - [ ] `mergeTemplates()` 함수 구현
    - [ ] 지능적인 설정 조합 로직
    - [ ] 시스템 메시지 통합 알고리즘
  - [ ] `interpolateTemplate()` 함수 구현
    - [ ] 변수 보간 시스템
    - [ ] 문자열 필드 동적 치환
  - [ ] `createVariation()` 함수 구현
    - [ ] 템플릿 변형 검증
    - [ ] 일관성 검사 로직

### 1.4 도구 관리 시스템 구현
- [ ] `packages/agents/src/managers/tool-management.ts` 파일 생성
  - [ ] 3계층 도구 관리 시스템
    - [ ] AgentFactory 레벨: 공통 도구 관리
    - [ ] Template 레벨: 템플릿별 특화 도구
    - [ ] Agent 레벨: 최종 도구 보유
  - [ ] 도구 충돌 해결 시스템
    - [ ] 우선순위 규칙 처리
    - [ ] 상호 배타적 도구 관리
    - [ ] 의존성 해결
  - [ ] 동적 도구 할당 시스템
    - [ ] 실행 시점 도구 요청 처리
    - [ ] 리소스 제약 검증
    - [ ] 사용량 추적 및 최적화

### 1.5 리소스 관리 및 생명주기 관리
- [ ] `packages/agents/src/managers/resource-manager.ts` 파일 생성
  - [ ] 에이전트 생명주기 추적
  - [ ] 메모리 사용량 모니터링
  - [ ] 토큰 사용량 관리
  - [ ] 동시성 제한 처리
- [ ] `packages/agents/src/managers/lifecycle-manager.ts` 파일 생성
  - [ ] 에이전트 상태 관리
  - [ ] 자동 최적화 로직
  - [ ] 리소스 정리 시스템

---

## Phase 2: Planning 코어 시스템 구축 (우선순위: 높음)

### 2.1 패키지 기본 구조 생성
- [ ] `packages/planning` 폴더 생성
- [ ] 패키지 설정 파일들 구성
  - [ ] `package.json` - 기존 패키지 구조 참조하여 생성
  - [ ] `tsconfig.json` - TypeScript 설정 (Semantic naming 준수)
  - [ ] `tsconfig.test.json` - 테스트용 TypeScript 설정  
  - [ ] `tsup.config.ts` - 빌드 설정
  - [ ] `vitest.config.ts` - 테스트 설정
- [ ] 기본 폴더 구조 생성
  ```
  packages/planning/src/
  ├── abstracts/          # BasePlanner 등 추상 클래스
  ├── interfaces/         # Planning 타입 정의
  ├── planners/          # 구체적인 플래너 구현들
  ├── utils/             # 유틸리티 함수들
  ├── containers/        # PlannerContainer 관련
  └── index.ts           # 패키지 exports
  ```

### 2.2 Planning 타입 시스템 구현
- [ ] `src/interfaces/planning-types.ts` 파일 생성
  - [ ] Planning 전용 semantic 타입 정의
    ```typescript
    // Planning 입력 메타데이터
    type PlanningInputMetadata = Record<string, string | number | boolean | Date>;
    
    // Planning 단계 설정값
    type PlanningStepConfigValue = string | number | boolean;
    
    // Planning 실행 결과 데이터
    type PlanningExecutionResultData = Record<string, string | number | boolean | Date>;
    
    // Planning 컨텍스트 매개변수
    type PlanningContextParameters = Record<string, string | number | boolean | string[]>;
    ```
  - [ ] `PlanningExecutionInput` 인터페이스 정의
  - [ ] `PlanningExecutionStep` 인터페이스 정의  
  - [ ] `PlanningExecutionResult` 인터페이스 정의
  - [ ] `PlannerConfiguration` 인터페이스 정의
  - [ ] `PlanningSessionContext` 인터페이스 정의
- [ ] `src/interfaces/index.ts` - 타입 re-export
- [ ] agents 패키지 타입들과 호환성 검증

### 2.3 BasePlanner 추상 클래스 구현
- [ ] `src/abstracts/base-planner.ts` 파일 생성
- [ ] BasePlanner 클래스 구현 (타입 매개변수 강화)
  ```typescript
  abstract class BasePlanner<
    TPlannerConfig extends PlannerConfiguration,
    TExecutionContext extends PlanningSessionContext,
    TExecutionResult extends PlanningExecutionResult
  >
  ```
  - [ ] 제네릭 타입 매개변수 정의 (설명적 명명)
  - [ ] 추상 메서드들 정의
    - [ ] `initialize()` - 플래너 초기화
    - [ ] `plannerName()` - 플래너 이름 반환 (name() 충돌 방지)
    - [ ] `createPlan()` - 계획 수립
    - [ ] `executePlan()` - 계획 실행
  - [ ] 공통 기능 메서드들 구현
    - [ ] `configure()` - 설정 적용
    - [ ] `createAgent()` - AgentFactory 확장 기능 활용
    - [ ] `getAgent()` - 에이전트 조회
    - [ ] `ensureInitialized()` - 초기화 보장
    - [ ] `dispose()` - 리소스 정리
  - [ ] AgentFactory 확장 기능 통합
    - [ ] 조건부 에이전트 생성 활용
    - [ ] 배치 생성 활용
    - [ ] 동적 도구 주입 활용

### 2.4 PlannerContainer 클래스 구현
- [ ] `src/containers/planner-container.ts` 파일 생성
- [ ] PlannerContainer 클래스 구현 (AgentFactory 의존성 주입)
  - [ ] 생성자에서 AgentFactory 주입받기
  - [ ] 플래너 등록 처리
  - [ ] 실행 전략별 메서드 구현
    - [ ] `executeBestFirst()` - 최적 플래너 선택 실행
    - [ ] `executeSequential()` - 순차 실행
    - [ ] `executeParallel()` - 병렬 실행
    - [ ] `executeWithFallback()` - 폴백 실행
  - [ ] 세션 관리 시스템
    - [ ] `PlanningSessionMetadata` 타입 정의
    - [ ] 활성 세션 추적 및 관리
    - [ ] 세션 상태 관리 (planning/executing/completed/failed)
  - [ ] 플래너 선택 로직
    - [ ] `selectOptimalPlanner()` - 규칙 기반 플래너 선택
    - [ ] 기본 폴백 로직 구현
    - [ ] LLM 기반 선택 (추후 구현을 위한 인터페이스)

### 2.5 편의 함수 구현
- [ ] `src/create-planner.ts` 파일 생성
- [ ] `createPlanner()` 함수 구현
  - [ ] Team의 `createTeam()` 패턴 준수
  - [ ] AgentFactory 주입 지원
  - [ ] 옵션 검증 및 기본값 처리
  - [ ] PlannerContainer 인스턴스 생성 및 반환
  - [ ] Provider 불가지론 준수

### 2.6 패키지 exports 정리
- [ ] `src/index.ts` 파일 생성
- [ ] 주요 클래스 및 인터페이스 export
  - [ ] `BasePlanner` export
  - [ ] `PlannerContainer` export  
  - [ ] `createPlanner` export
  - [ ] 모든 Planning 인터페이스들 export
  - [ ] Semantic 타입들 export
- [ ] 패키지 진입점 정리

---

## Phase 3: 기존 Team과의 관계 정리 (우선순위: 높음)

### 3.1 마이그레이션 전략 구체화
- [ ] Team → CAMELPlanner 마이그레이션 계획 수립
  - [ ] 기존 Team 로직 분석 및 매핑
  - [ ] 하위 호환성 보장 방안
  - [ ] 점진적 마이그레이션 단계 정의
- [ ] 호환성 레이어 설계
  - [ ] Team 인터페이스 호환 래퍼 구현
  - [ ] 기존 사용자 코드 변경 최소화
  - [ ] Deprecation 경고 시스템

### 3.2 공통 인터페이스 설계
- [ ] `packages/agents/src/interfaces/migration.ts` 파일 생성
  - [ ] Team-Planning 상호 운용성 인터페이스
  - [ ] 공통 에이전트 풀 인터페이스 설계
  - [ ] 통합 모니터링 인터페이스 설계
- [ ] 리소스 공유 메커니즘 구현
  - [ ] 에이전트 공유 인터페이스
  - [ ] 리소스 경합 방지 로직
  - [ ] 통합 분석 메트릭

### 3.3 문서화 및 가이드라인
- [ ] Team vs Planning 사용 사례 분석 문서 업데이트
- [ ] 마이그레이션 가이드 작성
  - [ ] 단계별 마이그레이션 절차
  - [ ] 코드 변환 예제
  - [ ] 주의사항 및 베스트 프랙티스
- [ ] 통합 사용 가이드 작성

---

## Phase 4: 첫 번째 플래너 구현 - Simple Sequential (우선순위: 중간)

### 4.1 SimpleSequentialPlanner 구현
- [ ] `src/planners/simple-sequential-planner.ts` 파일 생성
- [ ] SimpleSequentialPlanner 클래스 구현
  - [ ] BasePlanner 상속 (타입 매개변수 특화)
  - [ ] AgentFactory 확장 기능 활용
  - [ ] `createPlan()` 메서드 구현
    - [ ] 사용자 입력을 단계별로 분해
    - [ ] PlanningExecutionStep 배열 생성
    - [ ] 의존성 관계 설정
  - [ ] `executePlan()` 메서드 구현
    - [ ] 순차적 step 실행 로직
    - [ ] AgentFactory.createWithConditions() 활용
    - [ ] 단계별 결과 수집
    - [ ] 최종 결과 합성
- [ ] 설정 옵션 구현
  - [ ] 최대 단계 수 제한
  - [ ] 타임아웃 설정
  - [ ] 재시도 로직

### 4.2 테스트 및 검증
- [ ] SimpleSequentialPlanner 단위 테스트
  - [ ] AgentFactory 확장 기능과의 통합 테스트
  - [ ] 계획 수립 기능 테스트
  - [ ] 순차 실행 로직 테스트
  - [ ] 에러 처리 테스트
- [ ] 통합 테스트
  - [ ] PlannerContainer와의 통합 테스트
  - [ ] Provider 불가지론 테스트

---

## Phase 5: CAMEL 플래너 구현 (기존 Team 로직 발전) (우선순위: 중간)

### 5.1 기존 Team 시스템 완전 분석
- [ ] TeamContainer 코드 상세 분석 및 매핑
  - [ ] 델리게이션 로직 → CAMELPlanner 전환
  - [ ] 템플릿 선택 메커니즘 → AgentFactory 조건부 생성 활용
  - [ ] 에이전트 조정 패턴 → CAMEL 역할 기반 협업으로 발전
- [ ] CAMEL 패턴 최적화
  - [ ] 역할 기반 다중 에이전트 커뮤니케이션
  - [ ] 태스크 분해 및 할당 전략
  - [ ] AgentFactory 배치 생성 활용

### 5.2 CAMELPlanner 구현
- [ ] `src/planners/camel-planner.ts` 파일 생성
- [ ] CAMELPlanner 클래스 구현
  - [ ] BasePlanner 상속 (CAMEL 특화 타입)
  - [ ] AgentFactory 확장 기능 완전 활용
    - [ ] `createBatch()` 로 역할별 에이전트 생성
    - [ ] 조건부 생성으로 역할별 최적화
    - [ ] 도구 주입 전략 활용
  - [ ] 역할 기반 에이전트 조정 로직
    - [ ] 역할 정의 및 할당
    - [ ] 에이전트 간 커뮤니케이션 프로토콜
    - [ ] 작업 분배 및 조정
  - [ ] 기존 템플릿 시스템 발전적 활용
    - [ ] 7개 빌트인 템플릿 완전 호환
    - [ ] Planning 컨텍스트에 맞게 조정
  - [ ] `createPlan()` 메서드 구현
    - [ ] 작업 분석 및 역할 식별
    - [ ] 에이전트별 계획 수립
    - [ ] 의존성 및 커뮤니케이션 계획
  - [ ] `executePlan()` 메서드 구현
    - [ ] 역할별 에이전트 배치 생성
    - [ ] 협업 워크플로우 실행
    - [ ] 결과 통합 및 품질 검증

### 5.3 Team과의 완전한 차별화
- [ ] 기능적 차별화 구현
  - [ ] Team: 즉시 델리게이션 + 템플릿 기반
  - [ ] CAMEL Planner: 계획 수립 + 역할 분석 + 전략적 실행 + AgentFactory 확장 활용
- [ ] 성능 및 품질 향상
  - [ ] AgentFactory 확장 기능 활용한 최적화
  - [ ] 동적 도구 할당
  - [ ] 리소스 관리 개선

### 5.4 마이그레이션 지원 구현
- [ ] Team → CAMELPlanner 마이그레이션 도구 구현
- [ ] 호환성 테스트 완전 수행
- [ ] 성능 비교 테스트
- [ ] 결과 품질 비교 테스트

---

## Phase 6: 추가 플래너 구현 (우선순위: 낮음)

### 6.1 ReActPlanner 구현
- [ ] `src/planners/react-planner.ts` 파일 생성
- [ ] ReAct (Reason + Act) 패턴 구현
  - [ ] AgentFactory.createFromPrompt() 활용
  - [ ] Thought → Action → Observation 사이클
  - [ ] 동적 도구 선택 및 사용
  - [ ] 동적 계획 수정 기능
- [ ] 도구 통합 최적화
  - [ ] AgentFactory 도구 관리 시스템 활용
  - [ ] 도구 선택 및 실행 최적화
- [ ] 테스트 및 문서화

### 6.2 ReflectionPlanner 구현
- [ ] `src/planners/reflection-planner.ts` 파일 생성
- [ ] Reflection 패턴 구현
  - [ ] AgentFactory 템플릿 변형 기능 활용
  - [ ] 자기 평가 및 피드백 루프
  - [ ] 품질 개선 중심의 플래닝
  - [ ] 반복적 개선 프로세스
- [ ] 품질 메트릭 시스템
  - [ ] 결과 품질 평가 기준
  - [ ] 개선 제안 생성 로직
- [ ] 테스트 및 문서화

---

## Phase 7: 고급 기능 및 최적화 (우선순위: 낮음)

### 7.1 지능형 플래너 선택
- [ ] LLM 기반 플래너 선택 시스템
  - [ ] AgentFactory.createFromPrompt() 활용한 분석 에이전트
  - [ ] 플래너 특성 데이터베이스 구축
  - [ ] 매칭 알고리즘 구현
- [ ] 성능 학습 시스템
  - [ ] AgentFactory 모니터링 활용
  - [ ] 플래너별 성능 프로파일 구축
  - [ ] 추천 정확도 개선

### 7.2 하이브리드 실행 엔진
- [ ] Team + Planning 통합 실행 엔진
  - [ ] AgentFactory 공유 풀 활용
  - [ ] 작업 타입별 자동 라우팅
  - [ ] 리소스 공유 및 조정
  - [ ] 통합 모니터링 대시보드
- [ ] 복잡한 워크플로우 처리
  - [ ] 조건부 실행 로직
  - [ ] 동적 플래너 전환
  - [ ] 오류 복구 전략

### 7.3 성능 최적화
- [ ] AgentFactory 리소스 관리 활용
  - [ ] 에이전트 풀링 시스템
  - [ ] 리소스 사용량 최적화
  - [ ] 메모리 관리 개선
- [ ] 플래닝 캐싱
  - [ ] 유사 요청 캐싱 시스템
  - [ ] 부분 계획 재사용
  - [ ] 성능 향상 검증

---

## 현실적인 일정 (AgentFactory 확장 반영)

### 1-2주차: Phase 1 (AgentFactory 확장)
- Week 1: AgentFactory 확장 타입 시스템 및 조건부 생성
- Week 2: 템플릿 조작, 도구 관리, 리소스 관리 시스템

### 3주차: Phase 2 (Planning 코어 시스템)
- Day 1-3: 패키지 구조 및 Planning 타입 시스템
- Day 4-5: BasePlanner 구현 (AgentFactory 확장 활용)
- Day 6-7: PlannerContainer 및 편의 함수 구현

### 4주차: Phase 3 (Team 관계 정리)
- Day 1-3: 마이그레이션 전략 및 호환성 레이어
- Day 4-5: 공통 인터페이스 설계
- Day 6-7: 문서화 및 가이드라인

### 5주차: Phase 4 (SimpleSequentialPlanner)
- Day 1-4: SimpleSequentialPlanner 구현
- Day 5-7: 테스트 및 통합 검증

### 6-7주차: Phase 5 (CAMELPlanner)
- Week 6: Team 시스템 분석 및 CAMELPlanner 구현
- Week 7: 마이그레이션 지원 및 호환성 테스트

### 이후: Phase 6-7 (점진적 확장)
- 월 1개 플래너 추가 구현
- AgentFactory 확장 기능 지속 개선
- 커뮤니티 피드백 기반 최적화

---

## 성공 지표 (업데이트됨)

### 기술적 지표
- [ ] 모든 테스트 통과 (단위/통합/E2E)
- [ ] TypeScript 컴파일 오류 0개
- [ ] 코드 커버리지 90% 이상
- [ ] **Semantic Type Naming 100% 준수**
- [ ] **Provider 불가지론 100% 준수**
- [ ] **AgentFactory 확장 기능 완전 통합**
- [ ] 기존 Team 패키지와 호환성 100%

### 사용성 지표
- [ ] AgentFactory 확장 기능 활용 가이드
- [ ] 명확한 Team vs Planning 사용 가이드
- [ ] 실제 프로젝트에서 활용 가능한 예제들
- [ ] 마이그레이션 도구 및 가이드
- [ ] 개발자 피드백 긍정적

### 성능 지표
- [ ] AgentFactory 확장으로 인한 성능 향상 입증
- [ ] 단순 작업에서 Team 대비 성능 손실 < 10%
- [ ] 복잡한 작업에서 Planning 우위성 입증
- [ ] 메모리 사용량 최적화
- [ ] 응답 시간 허용 범위 내

---

## 리스크 및 대응 방안 (업데이트됨)

### 주요 리스크
1. **AgentFactory 확장의 복잡성**
   - 대응: 단계적 구현 및 철저한 테스트
2. **기존 사용자 호환성**
   - 대응: 완전한 하위 호환성 보장 및 마이그레이션 도구
3. **Type Safety 유지**
   - 대응: Semantic naming 엄격 준수 및 자동화된 검증
4. **성능 최적화**
   - 대응: AgentFactory 리소스 관리 시스템 활용

### 품질 관리
- 사용자 규칙 준수 자동 검증 도구 개발
- AgentFactory 확장 기능 단위별 성능 테스트
- 매주 팀 리뷰 및 피드백
- 기존 Team 사용자 대상 베타 테스트
- 지속적인 성능 모니터링
- 커뮤니티 피드백 적극 수용

---

## 핵심 변경사항 요약

### 1. AgentFactory 확장 최우선 순위화
- **이유**: Planning 시스템의 핵심 엔진 역할
- **영향**: 모든 플래너가 확장된 AgentFactory 기능 활용

### 2. 사용자 규칙 완전 준수
- **Semantic Type Naming**: 모든 타입명에 스코프+목적+컨텍스트 명시
- **Provider 불가지론**: 특정 AI Provider에 의존하지 않는 설계
- **타입 안전성**: Zero any/unknown 정책 유지

### 3. Team과의 차별화 강화
- **CAMELPlanner**: Team의 발전된 형태로 완전 대체
- **마이그레이션 지원**: 점진적 전환 도구 및 가이드 제공
- **성능 향상**: AgentFactory 확장 기능 활용한 최적화

이 업데이트된 로드맵은 사용자의 규칙을 완전히 준수하며, AgentFactory 확장 전략을 중심으로 한 강력한 Planning 시스템 구축을 목표로 합니다. 