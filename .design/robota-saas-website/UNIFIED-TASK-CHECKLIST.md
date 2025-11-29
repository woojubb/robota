# 📋 Robota SaaS 플랫폼 통합 작업 개요

> Fork/Join 안정화, Playground, Pricing 제거 등 실제 실행 계획은 `CURRENT-TASKS.md`의 Priority 1~4 섹션에서 관리합니다. 이 문서는 웹/SaaS 전반의 큰 방향과 참고 메모만 제공합니다.

## 1. 워크플로우 시각화 안정성
- 목표: Fork/Join Path-Only 규칙을 완성하여 `thinking → tool_call → agent response → tool_response → tool_result → next thinking` 흐름을 안정화
- 조치: `WorkflowEventSubscriber` 맵/헬퍼 정비, 레거시 보정 로직 제거, 예제 26 및 05-team-collaboration 검증
- 세부 체크리스트: `CURRENT-TASKS.md` Priority 2 (A-1~A-4)

## 2. 웹 플랫폼 개발
- Playground Tools DnD, 실시간 채팅+워크플로우, 에러 시각화, 저장/재보기
- Dashboard/프론트엔드: 실행 히스토리, 메트릭 시각화, React 컴포넌트, WebSocket 실시간 업데이트
- 세부 체크리스트: `CURRENT-TASKS.md` Priority 3

## 3. 기능 확장
- 워크플로우 고도화(커스텀 노드, 템플릿, 비교, 분석)
- AI 모델 확장, Team 기능 강화(다단계 assignTask, 성능 분석)
- Path-Only/이벤트 소유권 준수는 공통 조건

## 4. 인프라·성능·보안
- 대규모 워크플로우 최적화, 렌더링 가상화, 데이터 압축/스트리밍
- 서버 사이드 렌더링, 분산 처리, 모니터링, 암호화/권한 관리

## 5. UX·접근성·온보딩
- DnD 편집기, 미리보기/시뮬레이션, 모바일 대응, 고대비/i18n, 튜토리얼/샘플

## 6. 분석·모니터링
- 사용자 행동 분석, A/B 테스트, SLA, 오류 추적, 경쟁/시장 분석

---

필요한 세부 단계가 생기면 `CURRENT-TASKS.md`에 Priority 항목을 추가한 뒤, 이 문서에서는 개요만 유지하세요.
