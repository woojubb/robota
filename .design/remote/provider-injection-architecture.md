# Provider Injection Architecture (요약)

> Provider 주입 방식에 대한 세부 구현은 Remote System 문서와 CURRENT-TASKS Priority 0/1에서 다룹니다. 본 문서는 Provider/Executor 주입 패턴을 간단히 설명합니다.

## 목표
- 각 Provider가 `executor`와 `logger`, `eventService` 등 추상 의존성만 주입받도록 하여 테스트/Remote 연동을 단순화
- ProviderFactory/Manager가 Provider 인스턴스를 생성할 때 모든 공통 의존성을 자동 주입

## 패턴 요약
```ts
const provider = new OpenAIProvider({
  executor,
  eventService: toolEventService,
  logger: SilentLogger,
  defaultModel: config.defaultModel,
});
```
- executor가 주어지면 executor 경로를 사용하고, 없으면 provider의 direct client 호출을 사용한다(대체 경로라는 용어를 쓰지 않는다).
- Tool 실행은 `ToolExecutionContext.eventService`(tool-call owner-bound, ownerPath-only)를 주입받아 사용한다(이벤트명은 상수 사용).

## 효과
- Provider 테스트를 executor mock으로 대체 가능
- API Key/모델 설정을 Remote Server가 소유하여 보안 향상
- 신규 Provider 추가 시 최소한의 코드 변경으로 Remote 연동 가능

---

세부 실행 단계는 `CURRENT-TASKS.md`와 `.design/open-tasks/REMOTE-SYSTEM.md`를 참고하세요.
