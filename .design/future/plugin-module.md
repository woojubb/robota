# Plugin / Module 분리 (장기 구상)

## 원칙
- Module/Plugin 없이도 기본 대화가 가능해야 한다(선택적 확장).
- Plugin/Module 간 결합은 이벤트 기반으로 유지한다.

## 현재 스펙과의 관계
- 현재 실행/이벤트/워크플로우 연결 규칙은 `specs/event-system.md`, `specs/workflow-graph.md`가 단일 기준이다.
- Module 관련 장기 구상은 정식 스펙이 아니며, 구현이 시작되면 `CURRENT-TASKS.md`로 승격한다.


