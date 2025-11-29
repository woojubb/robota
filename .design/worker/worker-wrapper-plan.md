# WorkerWrapper Plan (요약)

> WorkerWrapper 패키지 개발 세부 작업은 향후 `CURRENT-TASKS.md` 항목으로 관리합니다. 이 문서는 목표와 설계 원칙만 남겨둡니다.

## 목표
- Robota SDK 구성 요소를 Web Worker/Node Worker 환경에서 실행할 수 있는 `@robota-sdk/worker` 패키지 제공
- 기존 패키지들은 Worker 존재를 모르게 유지하고, Wrapper가 모든 Worker 의존성을 담당

## 설계 원칙
1. **순수성 유지**: 기존 패키지는 Worker와 무관, `@robota-sdk/worker`만 다른 패키지를 감싼다
2. **Proxy 패턴**: `WorkerWrapper`가 메서드 호출을 Worker 스레드로 투명하게 위임
3. **Zero-Config + 선택적 Factory**: 기본 환경에서는 자동 Worker 사용, 필요 시 Web/Node/Custom Factory 주입
4. **환경 중립**: Worker 감지/생성 로직은 최소한으로 유지하고 명확한 에러 메시지를 제공

## 기본 구조 (요약)
- `wrapper/worker-wrapper.ts`, `runtime/worker-runtime.ts`, `communication/message-protocol.ts` 등 모듈별 역할 분리
- Worker 내부는 인스턴스 매니저와 타입 레지스트리로 구성하여 Class 등록/생명주기를 관리

## 로드맵 개요
1. **Phase 1**: 패키지 스캐폴딩, 인터페이스 정의, WorkerWrapper/Runtime 골격 구현
2. **Phase 2**: 기본/웹/노드 Factory, 통신 프로토콜, 타입 검증, 기본 테스트
3. **Phase 3**: 스트리밍 지원, 고급 팩토리 최적화, 예제/문서
4. **Phase 4**: Playground/CLI 통합, Guarded 테스트, 배포

---

추가 작업이 필요하면 CURRENT-TASKS에 WorkerWrapper 항목을 추가해 주세요.
