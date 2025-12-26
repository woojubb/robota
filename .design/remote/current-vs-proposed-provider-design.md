# Provider Design (Current vs Proposed)

> 상세 구현은 `.design/open-tasks/REMOTE-SYSTEM.md`와 `CURRENT-TASKS.md`에서 추적합니다. 본 문서는 Provider 계층의 핵심 차이를 개요로 남깁니다.

## 현재 구조 (요약)
- Provider마다 API Client를 직접 소유, 실행 시 API Key/모델 정보를 직접 주입
- RemoteExecutor가 없는 경우 Provider가 직접 REST 호출 수행
- 이벤트 로깅/추적이 Provider마다 상이

## 제안된 구조
- 모든 Provider가 `executor` 옵션을 통해 RemoteExecutor에 위임 (`executeViaExecutorOrDirect()`)
- 모델/키 관리는 Remote Server가 담당, 클라이언트는 user API token만 전달
- 로깅/추적은 owner-bound EventService(absolute ownerPath-only) + Remote Server middleware에서 일원화

## 기대 효과
- API Key 관리 단일화, 보안 강화
- Playground/Server/CLI가 동일 실행 경로 공유
- Provider 추가 시 공통 Executor 인터페이스만 구현하면 됨

## 참고 링크
- `.design/open-tasks/REMOTE-SYSTEM.md`
