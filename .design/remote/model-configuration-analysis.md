# Remote Model Configuration 요약

> 실행 계획은 `CURRENT-TASKS.md` Priority 0/1과 `.design/open-tasks/REMOTE-SYSTEM.md`에서 관리합니다. 본 문서는 Remote 환경에서 모델 구성을 어떻게 다루는지 간단히 요약합니다.

## 문제 요약
- 클라이언트(UI/CLI)가 모델 이름, API Key, 옵션을 직접 관리하면서 환경별 설정이 중복됨
- RemoteExecutor를 사용하는 경우에도 모델 구성이 Provider별로 흩어져 있음

## 제안 요약
- Remote Server가 `defaultModel`(provider, model, temperature 등)을 단일 JSON 스키마로 저장
- Playground/CLI는 모델 프리셋 ID만 전달하며, 실제 모델 선택은 Remote Server가 수행
- 사용자는 `PATCH /v1/remote/models/:presetId` API로 설정 변경, 변경 사항은 RemoteExecutor 캐시를 통해 모든 세션에 반영

## 기대 효과
- 모델 변경/회수 시 클라이언트 업데이트 없이 Remote Server만 배포하면 됨
- Secrets/API Key를 클라이언트에 노출하지 않음
- Provider별 권장 옵션을 서버에서 강제할 수 있음

---

추가 세부사항이 필요하면 Remote System 문서와 CURRENT-TASKS를 참고하세요.
