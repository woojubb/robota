# AgentFactory Expansion (요약)

> AgentFactory 관련 실제 구현 계획은 `CURRENT-TASKS.md`와 `.design/open-tasks/FUTURE-PROJECTS.md`에서 관리합니다. 이 문서는 확장 방향만 간단히 남깁니다.

## 목표
- `AgentFactory.createFromConfig()`가 Planner/Playground/CLI에서 공통으로 사용될 수 있도록 Config 기반 생성 경로를 표준화
- 조건부 생성(`createWithConditions`), 프롬프트 템플릿 병합, 배치 생성 등 고급 API를 단계적으로 추가

## 핵심 아이디어
1. **Config Object**: `{ id, name, defaultModel, tools, metadata, version }`
2. **ToolFactory 연동**: `ToolConfig[]`를 받아 UnifiedToolFactory로 Tool 인스턴스 생성
3. **Versioning**: Agent 설정 변경 시 version++ 및 `agent.config_updated` 이벤트 emit
4. **Validation**: Config 적용 전 Schema Validation + ActionTrackingEventService 로깅

---

세부 구현 단계는 CURRENT-TASKS 또는 관련 PR 계획을 참고하세요.
