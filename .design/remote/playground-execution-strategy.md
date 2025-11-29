# Playground Execution Strategy (요약)

> 플레이그라운드 실행 흐름에 대한 세부 구현은 `apps/web/src/lib/playground`와 `.design/open-tasks/REMOTE-SYSTEM.md`에서 추적합니다. 본 문서는 RemoteExecutor 기반 Playground 전략을 간략히 설명합니다.

## 전략 개요
1. **단일 실행 경로**: Playground → RemoteExecutor → Remote Server → Provider. 로컬 모드/직접 키 입력은 제거
2. **Mock ↔ Real 전환**: 개발 중에는 Mock SDK로 UI를 테스트하고, RemoteExecutor 연결만 바꿔서 실제 API를 호출
3. **실행 파이프라인**:
   - 사용자 입력 → Web Worker (코드 변환/ESM sandbox)
   - 변환 결과를 RemoteExecutor에 전달 (user token 포함)
   - Remote Server가 Provider 호출 및 SSE 스트리밍 처리
4. **검증**: 예제 10/26 실행 시 Guarded Runner 사용, 실패 시 검증 스크립트 중단

## 남은 과제 (요약)
- Import 변환 실패 케이스 보완
- Mock → RemoteExecutor 연결 테스트 자동화
- 실시간 스트리밍을 Playground UI에 자연스럽게 표시

---

세부 단계는 CURRENT-TASKS Priority 3/4 및 REMOTE-SYSTEM 문서를 참고하세요.
