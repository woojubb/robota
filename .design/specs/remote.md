# Remote 스펙 (최신)

## 목표
- provider가 네트워크 호출을 직접 담당하지 않고, **Executor 주입**으로 원격 실행을 지원한다.
- 로컬/원격에서 동일한 요청/응답 계약을 사용한다(SSOT 타입 사용).

## 구성 요소
- RemoteExecutor: 원격 실행을 담당하는 executor 구현체
- RemoteServer: 원격 실행 요청을 받아 provider 호출을 수행하고 결과를 반환
- Transport: HTTP 기반 요청/응답 및 스트리밍 경로 제공

## Provider 주입 원칙
- provider는 `executor`, `logger` 같은 추상 의존성만 주입받는다.
- Tool 실행은 `ToolExecutionContext.eventService`(tool-call owner-bound, ownerPath-only)를 사용한다.

## 이벤트/컨텍스트 원칙
- Remote 경로에서도 이벤트/관계 규칙은 동일하게 ownerPath-only를 따른다.
- 이벤트명은 상수만 사용한다.

## Playground 연동(요약)
- Playground의 실행 요청은 RemoteExecutor를 통해 수행한다(단일 실행 경로).
- UI는 실행 결과/워크플로우를 표시하고, provider 키/호출은 원격으로 집중한다.

## 범위
- 배포/운영 체크리스트는 `CURRENT-TASKS.md`의 [ ] 항목으로만 관리한다.


