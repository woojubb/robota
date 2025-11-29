# Runtime Model Switching Analysis (요약)

> 모델 전환 전략의 세부 구현은 Remote System 문서와 CURRENT-TASKS에 따라 수행합니다. 이 문서는 런타임 모델 변경 시 고려 사항만 정리합니다.

## 요구 사항
- Playground/CLI에서 실행 중 모델을 바꾸더라도 세션을 재시작하지 않아야 함
- 모델 전환은 Remote Server의 preset 업데이트를 통해 이루어져야 하며, 클라이언트에 키/모델을 노출하지 않음

## 제안
1. **Preset 기반 API**
   - `PATCH /v1/remote/models/:presetId`로 모델/옵션 업데이트
   - 실행 요청은 presetId만 전달
2. **세션 동기화**
   - RemoteExecutor는 preset 버전을 캐싱하고, 변경 이벤트를 SSE로 전달하여 UI가 최신 정보를 표시
3. **Fallback 금지**
   - preset을 찾을 수 없거나 권한이 없으면 즉시 에러 반환 (default 모델로 강제 전환 금지)
4. **옵션 검증**
   - 서버에서 provider-specific schema validation을 수행하여 런타임 오류를 조기에 방지

## 남은 과제
- 모델 변경 이벤트와 실행 로그를 ActionTrackingEventService + Remote Server 로깅으로 통합
- preset 변경을 Audit Trail에 기록하여 추적 가능성 확보

---

보다 자세한 단계는 REMOTE-SYSTEM 및 CURRENT-TASKS 문서를 참고하십시오.
