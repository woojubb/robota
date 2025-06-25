# Robota SDK 기반 Agentic AI 플래닝 설계 문서

## 개요

이 문서는 Robota SDK를 기반으로 한 Agentic AI 시스템에서 플래너(Planner)들을 어떻게 설계하고 조합할 것인지를 설명한다. 시스템은 다양한 플래닝 전략을 개별 라이브러리로 분리하여 설계하고, 이를 하나의 매니저에서 조합해 실행 가능한 구조를 목표로 한다.

---

## 핵심 구성 요소

### 1. **AbstractPlanner (추상 플래너 클래스)**

* 모든 플래닝 전략은 이 클래스를 상속하여 구현
* 필수 메서드:

  * `name()`: 플래너 이름 반환
  * `plan(input: PlanInput): PlanStep[]`
  * `executeStep(step: PlanStep): PlanResult`
  * 선택적으로 `finalize(results: PlanResult[])` 포함 가능

### 2. **PlannerManager**

* 플래너 등록 및 조합 실행 담당
* 여러 개의 플래너를 순차 또는 병렬로 실행 가능
* 인터페이스:

  * `register(planner: AbstractPlanner)`
  * `runSequential(plannerNames: string[], input: PlanInput): PlanResult[]`
  * 추후 `runParallel`, `runWithFallback` 등의 조합 방식도 확장 가능

### 3. **Robota (에이전트 구현체)**

* 실제 사용자 요청을 받아 처리하는 Agent 클래스
* 내부에서 PlannerManager를 사용하여 전략 조합 실행
* 사용자와의 인터페이스 역할을 담당

### 4. **AgentFactory**

* Robota를 설정 기반으로 생성하는 클래스
* 각 전략 라이브러리를 동적으로 import 및 등록

### 5. **플래너 전략 라이브러리**

* 각 플래닝 기법(ReAct, Reflection, Plan-and-Execute 등)은 독립적인 라이브러리로 개발
* 해당 라이브러리는 AbstractPlanner를 상속하여 구현
* 예시 라이브러리: `@robota-strategy/react`, `@robota-strategy/reflection`

---

## 플래너 조합 실행 예시

1. 사용자 입력: "이 함수 리팩토링해줘"
2. Robota가 이를 해석해 PlannerManager에 요청
3. Manager는 ReActPlanner → ReflectionPlanner 순으로 실행
4. 최종 결과를 Robota가 사용자에게 반환

이 과정은 모두 하나의 대화 히스토리(context) 내에서 이어지며, 각 플래너는 중간 상태를 공유하거나 독립적으로 결과를 출력할 수 있음

---

## 플래너 선택 전략

### A. 사전 고정 방식

* 사람이 특정 상황에 맞게 플래너를 지정
* 예: `runSequential(['react', 'reflection'])`

### B. LLM 기반 동적 선택

* LLM이 요청의 목적, 난이도, 맥락 등을 보고 적절한 플래너 조합을 판단
* 이 때 플래너 선택도 PlanStep의 일종으로 처리

### C. MCP 방식 하이브리드

* 위 두 방식을 혼합
* PlannerSelector 툴을 사용하여 LLM이 필요한 플래너 목록을 지정하고 Manager가 실행
* 예: LLM이 `["react", "reflection"]`을 반환 → Manager가 순차 실행

---

## 구조적 장점

* 전략 독립성 보장
* 외부 개발자 참여 가능 (플래너 생태계 확장)
* 실행 플로우 유연성 확보
* 디버깅 및 재현 가능성 향상

---

## 향후 확장 포인트

* `PlannerSelector`: 플래너를 선택하는 MCP 스타일 유닛
* `PlannerComposition`: 전략의 병렬 실행, 조건 분기, fallback 구조 추가
* `PlannerGraph`: 상태 기반 흐름 정의 (LangGraph 유사)
* `PlannerContext`: 공유 가능한 중간 상태 메모리 구조
* `PlanStepLog`: 전체 실행 히스토리 추적을 위한 로그 구조

---

이 문서는 Agentic 시스템에서 플래닝 전략을 효과적으로 관리하고 유연하게 조합하는 기반 설계를 제공한다. Robota 시스템은 내부적으로 다양한 플래너를 자율적으로 선택하고 연결할 수 있는 구조를 가지며, 확장 가능한 오픈형 아키텍처를 지향한다.
