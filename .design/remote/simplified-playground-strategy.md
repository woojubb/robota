# Simplified Playground Strategy (요약)

> Playground 전략의 상세 실행은 `CURRENT-TASKS.md` Priority 3 및 `.design/open-tasks/REMOTE-SYSTEM.md`에서 관리합니다. 이 문서는 간단한 전략만 남깁니다.

## 핵심 아이디어
- Playground는 "RemoteExecutor + Mock SDK" 두 경로만 제공 (로컬 Provider 직접 호출 제거)
- UI는 Tools DnD, Agent 설정, 코드 실행 결과 등을 단일 상태 트리에 저장하고, 실행 요청은 RemoteExecutor에만 의존
- 실행 로그/워크플로우는 Guarded Runner 규칙(예제 26 가드)으로 검증하여 Path-Only 위반을 조기에 발견

## 구현 가이드
1. 클라이언트는 `getPlaygroundToolCatalog()`와 preset된 Agent 템플릿으로 초기화
2. 코드 실행은 Web Worker sandbox에서 transpile 후 RemoteExecutor 호출
3. 결과는 SSE로 수신하여 UI 상태 + WorkflowVisualization에 반영

## 장점
- 구성 옵션이 단순해져 사용자 경험 향상
- Provider 키 관리가 서버로 집중
- PlaygroundUI/RemoteServer 간 계약이 명확해져 테스트 용이

---

세부 일정과 검증 절차는 CURRENT-TASKS를 참고하세요.
