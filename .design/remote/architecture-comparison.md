# Remote Architecture Comparison (Summary)

> 자세한 실행 계획은 `.design/open-tasks/REMOTE-SYSTEM.md` 및 `CURRENT-TASKS.md`에 정리되어 있습니다. 이 문서는 Remote Executor/Provider 통합을 위한 아키텍처 선택지를 간략히 비교합니다.

## 비교 축
1. **Executor 주입 방식** vs **직접 Provider 호출**
2. **단일 Remote Server** vs **하이브리드(Express + Firebase Functions)**
3. **SSE 기반 스트리밍** vs **WebSocket/gRPC 확장**

## 결론 요약
- **Executor 주입 방식**을 표준으로 채택하여 모든 Provider가 동일 API(`executeViaExecutorOrDirect`)를 사용
- **하이브리드 서버 구조**(Express + Functions)로 플레이그라운드·API 서버가 동일 Remote 패키지를 재사용
- **SSE**를 1차 채널로 유지하고, 차후 WebSocket/gRPC는 Phase 5 이후 추가 고려

## 참고 링크
- `.design/open-tasks/REMOTE-SYSTEM.md`
- `.design/open-tasks/CURRENT-TASKS.md` Priority 0/1 항목
