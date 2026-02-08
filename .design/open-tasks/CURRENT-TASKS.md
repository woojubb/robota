# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> 완료 항목은 `COMPLETED-TASKS.md`로 이동합니다.

---

## 🧩 Priority 0.7: Type Ownership Audit (SSOT) + Prefix Rollout

- [ ] StructuredEventService: owner prefix 합성 emit 적용(규칙 준수)
- [ ] └ 세부: 합성 함수 설계/적용, 영향 경로 확인 (예상 2.0h)
- [ ] local event name 검증: `.` 포함 시 오류 처리
- [ ] └ 세부: 로컬명 검증 위치 추가 및 오류 메시지 정리 (예상 0.5h)
- [ ] 사용자/태스크 이벤트 호출부: local name 기준으로 전환
- [ ] └ 세부: task/user 호출부 로컬명 전환 및 핸들러 교정 (예상 1.5h)
- [ ] Batch E 실행: Event name ownership 단일화(agents 소유, 비-owner 중복 제거/비공개화)
- [ ] └ 세부: 하드코딩 탐색 및 상수/emit 통일 (예상 1.5h)
- [ ] Type ownership audit 인벤토리 작성
- [ ] └ 세부: 범위 확정 → 수집 루틴 확정 → 표 작성 (예상 2.0h)
- [ ] Batch A 실행: UI/contexts/hooks 로컬 문자열 유니온 제거(Owner 타입 import로 수렴)
- [ ] └ 세부: 로컬 유니온 제거 및 Owner 타입 import 정리 (예상 2.0h)
- [ ] Batch B 실행: Message/Conversation 계약 단일화(Owner 타입으로 수렴)
- [ ] └ 세부: 계약 단일화 및 중복 제거 (예상 2.0h)
- [ ] Batch C 실행: Tool contract 단일화(Owner 타입으로 수렴)
- [ ] └ 세부: Tool contract 타입 단일화 (예상 2.0h)
- [ ] Batch D 실행: Workflow graph 계약 단일화(Owner 타입 import로 수렴)
- [ ] └ 세부: Workflow graph 계약 단일화 (예상 2.0h)

## 🧪 Scenario/Recorder 확장(필요 시)

- [ ] 시나리오 도메인 분리: `packages/workflow/src/scenario/*` 책임 분리
- [ ] Play 모드 tool 결과 재생 정책 반영: 기록 결과만 반환
- [ ] 단일 CLI 진입점 유지: record/play/verify 통합
- [ ] 병렬 tool call 기본 전략 확정: `hash` 기본
- [ ] Phase 2 이후 guarded 시나리오 검증 명령 재정의 및 실행(패키지별 템플릿)
