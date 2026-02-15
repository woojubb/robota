# 현재 작업 목록 (최신)

> 이 문서는 **남은 작업([ ])**만 관리합니다.  
> DAG 구현/리팩터링 완료 항목은 `COMPLETED-TASKS.md`로 이관했습니다.

---

## Node Lifecycle/Port Authoring 트랙

- [x] T-Node-1: `dag-core` 노드 계약 문서/타입 정합성 최종 고정
- [x] 완료 기준: `inputs[]/outputs[]` 필수 + 포트 메타데이터(`key/label/order/type/required`) 정책이 plan/spec와 코드에 일치

- [x] T-Node-2: 디자이너 Port Editor UI 구현
- [x] 완료 기준: 노드별 input/output 포트를 추가/수정/삭제 가능하고 변경이 definition 상태에 반영

- [x] T-Node-3: 포트 변경 시 edge binding 영향 검증 UX 추가
- [x] 완료 기준: 바인딩 깨짐/누락/타입 불일치를 명시 경고하고 자동 복구 없이 사용자 재매핑 유도

- [x] T-Node-4: 통합 검증(build/test)
- [x] 완료 기준: `dag-core`, `dag-designer`, `web`, `api-server` build 성공 + DAG 핵심 테스트 통과
