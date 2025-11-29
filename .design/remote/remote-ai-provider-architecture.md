# Remote AI Provider Architecture (요약)

> Remote Provider 아키텍처의 전체 상세는 `.design/open-tasks/REMOTE-SYSTEM.md`에 정리되어 있습니다. 이 문서는 계층 구조를 간략히 정리합니다.

## 계층
1. **Client (Playground/Web/CLI)**
   - RemoteExecutor 인스턴스 생성, user token 전달
   - 실행 요청/스트리밍 응답을 UI에 전달
2. **Remote Server**
   - REST/SSE 엔드포인트 (`/v1/remote/chat`, `/v1/remote/stream`)
   - ProviderManager/ExecutorInterface 구현
   - 인증, 로깅, 사용량 제한
3. **Provider Adapter**
   - OpenAI/Anthropic/Google 등 각 Provider SDK를 감싸고 executor 인터페이스 제공
   - 모델 프리셋/키/옵션을 서버에서 관리
4. **ExecutionService Integration**
   - RemoteExecutor가 Workflow Execution과 동일 EventService 계층을 사용
   - ActionTrackingEventService로 이벤트/경로를 일관되게 추적

## 데이터 흐름 요약
User Input → RemoteExecutor → Remote Server → Provider Adapter → LLM → Remote Server → SSE → Playground UI

## 장점
- Provider 교체/추가 시 Remote Server만 업데이트하면 됨
- 클라이언트에는 user token 외에 Secrets 필요 없음
- 사용량/로그/모니터링이 서버에서 일원화

---

세부 구현은 REMOTE-SYSTEM 문서와 CURRENT-TASKS를 참고해 주세요.
