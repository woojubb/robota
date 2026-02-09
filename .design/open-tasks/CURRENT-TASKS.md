# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> 완료 항목은 `COMPLETED-TASKS.md`로 이동합니다.

---

## 🗺️ Event 시스템 실행 계획(잔여 작업)

- [ ] 정책 확정: 이벤트 단위 최소 기록(수신 이벤트만 반영, 완결 가정 금지)
- [ ] 정책 확정: 정렬 기준 `ownerPath → timestamp → eventType/sequence`
- [ ] 오류 처리 단일화: 핸들러 내부 try/catch 제거 → 상위 기록
- [ ] 결과 구조 최소화: `success/updates/errors` 중심으로 축소
- [ ] `workflow-subscriber-event-service` 네이밍 역할 정리(Bridge/Adapter 명확화)
- [ ] `create*EventHandlers` 제거 → 단일 레지스트리 구성
- [ ] 처리 결과 구조 최소화(success/updates/errors만 유지)
- [ ] └ 세부: `metadata`/`processed` 플래그 최소화(필요 시 상위에서만 부여)

## 🧾 Event Log SSOT + 실시간 투영 계획(확정)

- [ ] Projection 캐시 설계(Workflow/History 분리)

## 🧪 Scenario/Recorder 확장(필요 시)

- [ ] 시나리오 도메인 분리: `packages/workflow/src/scenario/*` 책임 분리
- [ ] Play 모드 tool 결과 재생 정책 반영: 기록 결과만 반환
- [ ] 단일 CLI 진입점 유지: record/play/verify 통합
- [ ] 병렬 tool call 기본 전략 확정: `hash` 기본
- [ ] Phase 2 이후 guarded 시나리오 검증 명령 재정의 및 실행(패키지별 템플릿)

