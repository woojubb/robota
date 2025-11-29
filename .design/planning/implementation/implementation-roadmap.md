# Planning Implementation Roadmap (요약)

> 세부 일정은 `.design/open-tasks/FUTURE-PROJECTS.md`와 향후 `CURRENT-TASKS.md` 항목에서 관리합니다. 이 문서는 단계적 로드맵을 간단히 정리합니다.

1. **Phase 1 – Core (4주)**
   - BasePlanner, PlannerContainer, Planning Tool Registry 구현
   - AgentFactory 확장 API (`createFromConfig`, `updateConfiguration`)
2. **Phase 2 – Planner 구현 (6주)**
   - CAMEL → ReAct → Reflection → Sequential Planner 순으로 추가
   - 각 Planner는 동일한 인터페이스와 이벤트 프로토콜을 준수
3. **Phase 3 – 고급 기능 (4주)**
   - Planner Builder/Factory 패턴, 개발자 디버깅 도구
   - 성능 모니터링 및 장애 복구
4. **Phase 4 – 통합 배포 (3주)**
   - `@robota-sdk/planning` 패키지 배포, API 문서/예제/마이그레이션 가이드 제공

---

상세 체크리스트가 필요하면 FUTURE-PROJECTS 문서에 항목을 추가해 주세요.
