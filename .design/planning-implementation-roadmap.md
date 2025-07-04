# Planning 시스템 구현 로드맵

이 문서는 Robota SDK Planning 시스템을 구현하기 위한 체계적인 작업 계획과 체크리스트를 제공합니다.

## 개요

### 목표
- `@robota-sdk/planning` 패키지 구현
- 기존 `@robota-sdk/team`과 차별화된 전략적 플래닝 시스템 구축
- 다양한 플래닝 알고리즘을 조합할 수 있는 확장 가능한 아키텍처

### 현재 상황
- ✅ BaseAgent, AgentFactory, Team 시스템 완성
- ✅ 타입 안전한 플러그인 시스템 구축
- 🔄 Planning 시스템 신규 개발 필요

---

## Phase 1: 플래닝 코어 시스템 구축 (우선순위: 높음)

### 1.1 패키지 기본 구조 생성
- [ ] `packages/planning` 폴더 생성
- [ ] 패키지 설정 파일들 구성
  - [ ] `package.json` - 기존 패키지 구조 참조하여 생성
  - [ ] `tsconfig.json` - TypeScript 설정
  - [ ] `tsconfig.test.json` - 테스트용 TypeScript 설정  
  - [ ] `tsup.config.ts` - 빌드 설정
  - [ ] `vitest.config.ts` - 테스트 설정
- [ ] 기본 폴더 구조 생성
  ```
  packages/planning/src/
  ├── abstracts/          # BasePlanner 등 추상 클래스
  ├── interfaces/         # 타입 정의
  ├── planners/          # 구체적인 플래너 구현들
  ├── utils/             # 유틸리티 함수들
  └── index.ts           # 패키지 exports
  ```

### 1.2 타입 시스템 구현
- [ ] `src/interfaces/plan.ts` 파일 생성
  - [ ] `PlanInput` 인터페이스 정의
  - [ ] `PlanStep` 인터페이스 정의  
  - [ ] `PlanResult` 인터페이스 정의
  - [ ] `PlannerConfig` 인터페이스 정의
  - [ ] `PlanContext` 인터페이스 정의
  - [ ] ConfigValue 타입 제약 조건 준수 확인
- [ ] `src/interfaces/index.ts` - 타입 re-export
- [ ] 기존 agents 패키지 타입들과 호환성 검증

### 1.3 BasePlanner 추상 클래스 구현
- [ ] `src/abstracts/base-planner.ts` 파일 생성
- [ ] BasePlanner 클래스 구현
  - [ ] 제네릭 타입 매개변수 정의 `<TConfig, TContext, TPlan>`
  - [ ] 추상 메서드들 정의
    - [ ] `initialize()` - 플래너 초기화
    - [ ] `name()` - 플래너 이름 반환
    - [ ] `plan()` - 계획 수립
    - [ ] `execute()` - 계획 실행
  - [ ] 공통 기능 메서드들 구현
    - [ ] `configure()` - 설정 적용
    - [ ] `createAgent()` - 에이전트 생성 (AgentFactory 패턴 활용)
    - [ ] `getAgent()` - 에이전트 조회
    - [ ] `ensureInitialized()` - 초기화 보장
    - [ ] `dispose()` - 리소스 정리
- [ ] BaseAgent 패턴 일관성 확인
- [ ] 에이전트 생명주기 관리 로직 구현

### 1.4 PlannerContainer 클래스 구현
- [ ] `src/planner-container.ts` 파일 생성
- [ ] PlannerContainer 클래스 구현
  - [ ] 생성자에서 플래너 등록 처리
  - [ ] 실행 전략별 메서드 구현
    - [ ] `executeBestFirst()` - 최적 플래너 선택 실행
    - [ ] `executeSequential()` - 순차 실행
    - [ ] `executeParallel()` - 병렬 실행
    - [ ] `executeWithFallback()` - 폴백 실행
  - [ ] 세션 관리 시스템
    - [ ] `PlanningSession` 인터페이스 정의
    - [ ] 활성 세션 추적 및 관리
    - [ ] 세션 상태 관리 (planning/executing/completed/failed)
  - [ ] 플래너 선택 로직
    - [ ] `selectBestPlanner()` - LLM 기반 플래너 선택 (추후 구현)
    - [ ] 기본 폴백 로직 구현
- [ ] Team과의 차별화 포인트 명확히 구현
- [ ] 로깅 및 디버깅 지원

### 1.5 편의 함수 구현
- [ ] `src/create-planner.ts` 파일 생성
- [ ] `createPlanner()` 함수 구현
  - [ ] Team의 `createTeam()` 패턴 준수
  - [ ] 옵션 검증 및 기본값 처리
  - [ ] PlannerContainer 인스턴스 생성 및 반환
- [ ] 사용성 검증 및 API 일관성 확인

### 1.6 패키지 exports 정리
- [ ] `src/index.ts` 파일 생성
- [ ] 주요 클래스 및 인터페이스 export
  - [ ] `BasePlanner` export
  - [ ] `PlannerContainer` export  
  - [ ] `createPlanner` export
  - [ ] 모든 인터페이스들 export
- [ ] 패키지 진입점 정리

### 1.7 기본 테스트 작성
- [ ] `src/abstracts/base-planner.test.ts`
  - [ ] BasePlanner 추상 클래스 테스트 (Mock 구현 사용)
  - [ ] 에이전트 생성/관리 기능 테스트
  - [ ] 리소스 정리 기능 테스트
- [ ] `src/planner-container.test.ts`
  - [ ] PlannerContainer 기본 기능 테스트
  - [ ] 실행 전략별 테스트
  - [ ] 세션 관리 테스트
- [ ] `src/create-planner.test.ts`
  - [ ] createPlanner 함수 테스트
  - [ ] 옵션 검증 테스트
- [ ] 통합 테스트
  - [ ] agents 패키지와의 호환성 테스트
  - [ ] 타입 안전성 검증 테스트

---

## Phase 2: 기존 Team과의 관계 정리 (우선순위: 높음)

### 2.1 역할 차별화 명확화
- [ ] Team vs Planning 사용 사례 분석 문서 작성
  - [ ] Team: 템플릿 기반 즉시 델리게이션 사용 사례
  - [ ] Planning: 전략적 플래닝 알고리즘 사용 사례
  - [ ] 각각의 강점과 적용 분야 정리
- [ ] 사용자 가이드라인 작성
  - [ ] 언제 Team을 사용해야 하는지
  - [ ] 언제 Planning을 사용해야 하는지
  - [ ] 두 시스템을 함께 사용하는 방법

### 2.2 공통 인터페이스 설계
- [ ] 두 시스템 간 상호 운용성 분석
- [ ] 공통 에이전트 풀 인터페이스 설계
  - [ ] 에이전트 공유 메커니즘
  - [ ] 리소스 경합 방지 로직
- [ ] 통합 모니터링 인터페이스 설계
  - [ ] 공통 분석 메트릭 정의
  - [ ] 통합 대시보드 인터페이스

### 2.3 기존 사용자 영향도 분석
- [ ] Team 패키지 현재 사용자 조사
- [ ] 하위 호환성 보장 계획
- [ ] 마이그레이션 가이드 vs 병행 사용 결정
  - [ ] 기존 Team 사용자 보호 방안
  - [ ] 선택적 Planning 도입 방안
- [ ] Breaking Changes 최소화 계획

---

## Phase 3: 첫 번째 플래너 구현 - Simple Sequential (우선순위: 중간)

### 3.1 SimpleSequentialPlanner 구현
- [ ] `src/planners/simple-sequential-planner.ts` 파일 생성
- [ ] SimpleSequentialPlanner 클래스 구현
  - [ ] BasePlanner 상속
  - [ ] `plan()` 메서드 구현
    - [ ] 사용자 입력을 단계별로 분해
    - [ ] PlanStep 배열 생성
    - [ ] 의존성 관계 설정
  - [ ] `execute()` 메서드 구현
    - [ ] 순차적 step 실행 로직
    - [ ] 에이전트 생성 및 활용
    - [ ] 단계별 결과 수집
    - [ ] 최종 결과 합성
- [ ] 설정 옵션 구현
  - [ ] 최대 단계 수 제한
  - [ ] 타임아웃 설정
  - [ ] 재시도 로직

### 3.2 테스트 및 검증
- [ ] SimpleSequentialPlanner 단위 테스트
  - [ ] 계획 수립 기능 테스트
  - [ ] 순차 실행 로직 테스트
  - [ ] 에러 처리 테스트
- [ ] 통합 테스트
  - [ ] PlannerContainer와의 통합 테스트
  - [ ] 실제 AI 모델과의 연동 테스트

### 3.3 문서화 및 예제
- [ ] SimpleSequentialPlanner 사용법 문서 작성
- [ ] 코드 예제 작성
  - [ ] 기본 사용법 예제
  - [ ] 복잡한 워크플로우 예제
- [ ] Team과의 비교 예제 작성
  - [ ] 동일한 작업을 Team과 Planning으로 처리하는 비교
  - [ ] 각각의 장단점 실증

---

## Phase 4: CAMEL 플래너 구현 (기존 Team 로직 활용) (우선순위: 중간)

### 4.1 기존 Team 시스템 분석
- [ ] TeamContainer 코드 상세 분석
  - [ ] 델리게이션 로직 파악
  - [ ] 템플릿 선택 메커니즘 분석
  - [ ] 에이전트 조정 패턴 이해
- [ ] CAMEL 패턴 연구
  - [ ] 역할 기반 다중 에이전트 커뮤니케이션
  - [ ] 태스크 분해 및 할당 전략
- [ ] Team에서 재사용 가능한 부분 식별

### 4.2 CAMELPlanner 구현
- [ ] `src/planners/camel-planner.ts` 파일 생성
- [ ] CAMELPlanner 클래스 구현
  - [ ] BasePlanner 상속
  - [ ] 역할 기반 에이전트 조정 로직
    - [ ] 역할 정의 및 할당
    - [ ] 에이전트 간 커뮤니케이션 프로토콜
    - [ ] 작업 분배 및 조정
  - [ ] Team의 템플릿 시스템 활용
    - [ ] 기존 7개 템플릿 재활용
    - [ ] 플래닝 컨텍스트에 맞게 조정
  - [ ] `plan()` 메서드 구현
    - [ ] 작업 분석 및 역할 식별
    - [ ] 에이전트별 계획 수립
    - [ ] 의존성 및 커뮤니케이션 계획
  - [ ] `execute()` 메서드 구현
    - [ ] 역할별 에이전트 생성
    - [ ] 협업 워크플로우 실행
    - [ ] 결과 통합 및 품질 검증

### 4.3 Team과의 차별화
- [ ] 기능적 차별화 구현
  - [ ] Team: 즉시 델리게이션 + 템플릿 기반
  - [ ] CAMEL Planner: 계획 수립 + 역할 분석 + 전략적 실행
- [ ] 인터페이스 차별화
  - [ ] 다른 설정 옵션
  - [ ] 다른 실행 흐름
  - [ ] 다른 결과 포맷

### 4.4 호환성 테스트
- [ ] 기존 Team 사용자 워크플로우 테스트
- [ ] CAMEL 플래너로 마이그레이션 가능성 검증
- [ ] 성능 비교 테스트
- [ ] 결과 품질 비교 테스트

---

## Phase 5: 추가 플래너 구현 (우선순위: 낮음)

### 5.1 ReActPlanner 구현
- [ ] `src/planners/react-planner.ts` 파일 생성
- [ ] ReAct (Reason + Act) 패턴 구현
  - [ ] Thought → Action → Observation 사이클
  - [ ] 도구 사용 중심의 플래닝 전략
  - [ ] 동적 계획 수정 기능
- [ ] 도구 통합 최적화
  - [ ] 기존 Tool 시스템과 연동
  - [ ] 도구 선택 및 실행 최적화
- [ ] 테스트 및 문서화

### 5.2 ReflectionPlanner 구현
- [ ] `src/planners/reflection-planner.ts` 파일 생성
- [ ] Reflection 패턴 구현
  - [ ] 자기 평가 및 피드백 루프
  - [ ] 품질 개선 중심의 플래닝
  - [ ] 반복적 개선 프로세스
- [ ] 품질 메트릭 시스템
  - [ ] 결과 품질 평가 기준
  - [ ] 개선 제안 생성 로직
- [ ] 테스트 및 문서화

### 5.3 플래너 조합 예제
- [ ] 다중 플래너 사용 예제 작성
- [ ] 플래너 간 협업 시나리오 구현
- [ ] 성능 비교 및 분석

---

## Phase 6: 고급 기능 (우선순위: 낮음)

### 6.1 플래너 자동 선택
- [ ] LLM 기반 플래너 선택 시스템
  - [ ] 작업 분석 에이전트 구현
  - [ ] 플래너 특성 데이터베이스 구축
  - [ ] 매칭 알고리즘 구현
- [ ] 성능 학습 시스템
  - [ ] 실행 결과 품질 추적
  - [ ] 플래너별 성능 프로파일 구축
  - [ ] 추천 정확도 개선

### 6.2 하이브리드 실행
- [ ] Team + Planning 통합 실행 엔진
  - [ ] 작업 타입별 자동 라우팅
  - [ ] 리소스 공유 및 조정
  - [ ] 통합 모니터링 대시보드
- [ ] 복잡한 워크플로우 처리
  - [ ] 조건부 실행 로직
  - [ ] 동적 플래너 전환
  - [ ] 오류 복구 전략

### 6.3 성능 최적화
- [ ] 에이전트 풀링 시스템
  - [ ] 에이전트 재사용 로직
  - [ ] 리소스 사용량 최적화
  - [ ] 메모리 관리 개선
- [ ] 플래닝 캐싱
  - [ ] 유사 요청 캐싱 시스템
  - [ ] 부분 계획 재사용
  - [ ] 성능 향상 검증

---

## Phase 7: 생태계 확장 (우선순위: 낮음)

### 7.1 독립 플래너 패키지들
- [ ] `@robota-sdk/planner-react` 패키지 분리
- [ ] `@robota-sdk/planner-camel` 패키지 분리  
- [ ] `@robota-sdk/planner-reflection` 패키지 분리
- [ ] 각 패키지별 독립적 배포 환경 구축

### 7.2 커뮤니티 플래너 지원
- [ ] 플래너 개발 가이드 작성
  - [ ] BasePlanner 확장 방법
  - [ ] 플래너 인터페이스 가이드
  - [ ] 테스트 작성 가이드
- [ ] 플래너 레지스트리 시스템
  - [ ] 커뮤니티 플래너 등록/검색
  - [ ] 버전 관리 및 호환성 검증
  - [ ] 평가 및 피드백 시스템

---

## 현실적인 일정

### 1주차: Phase 1 (코어 시스템)
- Day 1-2: 패키지 구조 및 타입 시스템
- Day 3-4: BasePlanner 및 PlannerContainer 구현
- Day 5-7: 테스트 작성 및 디버깅

### 2주차: Phase 2-3 (관계 정리 및 첫 플래너)
- Day 1-3: Team과의 차별화 및 문서화
- Day 4-6: SimpleSequentialPlanner 구현
- Day 7: 통합 테스트 및 예제 작성

### 3-4주차: Phase 4 (CAMEL 플래너)
- Week 3: 기존 Team 로직 분석 및 CAMEL 패턴 연구
- Week 4: CAMELPlanner 구현 및 호환성 테스트

### 이후: Phase 5-7 (점진적 확장)
- 월 1개 플래너 추가 구현
- 커뮤니티 피드백 기반 개선
- 생태계 확장 및 최적화

---

## 성공 지표

### 기술적 지표
- [ ] 모든 테스트 통과 (단위/통합/E2E)
- [ ] TypeScript 컴파일 오류 0개
- [ ] 코드 커버리지 90% 이상
- [ ] 기존 Team 패키지와 호환성 100%

### 사용성 지표
- [ ] 명확한 Team vs Planning 사용 가이드
- [ ] 실제 프로젝트에서 활용 가능한 예제들
- [ ] 개발자 피드백 긍정적
- [ ] 커뮤니티 기여 시작

### 성능 지표
- [ ] 단순 작업에서 Team 대비 성능 손실 < 20%
- [ ] 복잡한 작업에서 Planning 우위성 입증
- [ ] 메모리 사용량 최적화
- [ ] 응답 시간 허용 범위 내

---

## 리스크 및 대응 방안

### 주요 리스크
1. **Team과의 차별화 부족**
   - 대응: 명확한 사용 사례 구분 및 실증
2. **기존 사용자 혼란**
   - 대응: 충분한 문서화 및 마이그레이션 가이드
3. **성능 이슈**
   - 대응: 단계별 성능 검증 및 최적화
4. **복잡성 증가**
   - 대응: 단순한 기본 기능부터 시작하여 점진적 확장

### 품질 관리
- 매주 팀 리뷰 및 피드백
- 기존 Team 사용자 대상 베타 테스트
- 지속적인 성능 모니터링
- 커뮤니티 피드백 적극 수용 