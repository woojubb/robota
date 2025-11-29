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
- executor가 주어지면 RemoteExecutor 경로를 사용하고, 없으면 기존 direct 호출 fallback (단, 프로덕션에서는 항상 executor 제공)
- EventService는 `clone({ ownerPrefix: 'tool' })`로 주입하여 도구 이벤트 접두어를 강제

## 효과
- Provider 테스트를 executor mock으로 대체 가능
- API Key/모델 설정을 Remote Server가 소유하여 보안 향상
- 신규 Provider 추가 시 최소한의 코드 변경으로 Remote 연동 가능

---

세부 실행 단계는 `CURRENT-TASKS.md`와 `.design/open-tasks/REMOTE-SYSTEM.md`를 참고하세요.
