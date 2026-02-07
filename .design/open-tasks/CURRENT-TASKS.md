# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> 완료 항목은 `COMPLETED-TASKS.md`로 이동합니다.

---

## 🧩 Priority 0.7: Type Ownership Audit (SSOT) + Prefix Rollout

- [ ] Type ownership audit 인벤토리 작성
- [ ] Batch A 실행: UI/contexts/hooks 로컬 문자열 유니온 제거(Owner 타입 import로 수렴)
- [ ] Batch B 실행: Message/Conversation 계약 단일화(Owner 타입으로 수렴)
- [ ] Batch C 실행: Tool contract 단일화(Owner 타입으로 수렴)
- [ ] Batch D 실행: Workflow graph 계약 단일화(Owner 타입 import로 수렴)
- [ ] Batch E 실행: Event axis 계약 단일화(agents 소유, 비-owner 중복 타입 제거/비공개화)

## 🧪 Scenario/Recorder 확장(필요 시)

- [ ] 시나리오 도메인 분리: `packages/workflow/src/scenario/*` 책임 분리
- [ ] Play 모드 tool 결과 재생 정책 반영: 기록 결과만 반환
- [ ] 단일 CLI 진입점 유지: record/play/verify 통합
- [ ] 병렬 tool call 기본 전략 확정: `hash` 기본
- [ ] Phase 2 이후 guarded 시나리오 검증 명령 재정의 및 실행(패키지별 템플릿)

## 🧩 예제 분산 계획(패키지별 “소유 예제”로 SSOT 준수)

- [ ] `apps/examples` 역할 결정: 패키지별 소유 예제로 이동(완료)
- [ ] 예제 실행 경로 스캐폴딩 확정: 패키지별 `examples/package.json` 필요 여부 결정
- [ ] 예제 이동 Batch 1 실행: 의존성 낮은 예제부터 이동(agents/openai 등)
- [ ] 예제 이동 Batch 2 실행: workflow 예제 이동 + CLI/유틸 소유 확정
- [ ] 예제 이동 Batch 3 실행: team/remote 등 나머지 이동
- [ ] 패키지별 예제 문서 정리: `examples/README.md` 작성
- [ ] `apps/examples` 문서 정리: 역할 결정에 따라 유지/축소/삭제
- [ ] 예제 타입체크 범위 재정의: 패키지별 포함 여부 결정 + 통합 job 최소화


