# Planning System Overview

> 장기 로드맵은 `.design/open-tasks/FUTURE-PROJECTS.md` Planning 섹션을 참고하세요. 이 문서는 Planning 시스템 목표만 요약합니다.

## 비전
- 복수의 Planner 전략(CAMEL/ReAct/Reflection/Sequential)을 하나의 SDK 패키지로 제공
- Planner가 생성한 실행 계획을 Agent/Tool 실행 파이프라인과 자연스럽게 연결
- RemoteExecutor/owner-bound EventService(absolute ownerPath-only) 인프라 위에서 동일한 Path-Only 규칙을 유지

## 단계
1. **Core Infrastructure**: BasePlanner, PlannerContainer, Planning Tool Registry
2. **Planner 구현**: CAMEL → ReAct → Reflection → Sequential 순으로 추가
3. **통합**: `@robota-sdk/planning` 패키지, `createPlanner()` 팩토리, 모니터링/복구 시스템

## 참고 링크
- `.design/open-tasks/FUTURE-PROJECTS.md`
- `packages/agents/src` Planner 관련 폴더 (추후 생성 예정)
