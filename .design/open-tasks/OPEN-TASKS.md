# 로보타 SaaS 웹 — 남은 작업(통합)

본 문서는 미완료 항목만 수록합니다. 완료된 내용은 `SPEC.md`를 참고하세요.

## A. Fork/Join Path-Only 마무리
- [ ] `workflow-state`의 보류/임시 큐/배리어 상태 제거(경량화)
- [ ] `ExecutionService` path 자동 주입/검증 강화(emit 전 검증 + clone tail required)
- [ ] `tool.call_response_ready` 처리: path.tail 기반 직접 매핑(응답 식별 우회 제거) 재검증
- [ ] `execution.tool_results_ready` 즉시 1회 발행(대기/재확인 금지) 재검증
- [ ] round2 thinking 입력: `tool_result → thinking(analyze)` 규칙 적용 검사

## B. 이벤트 소유권/검증
- [ ] `execution.*` emit은 `execution-service.ts` 한정 확인(전역 검사 스크립트/ESLint 룰 추가)
- [ ] EventService `ownerPrefix` 옵션/검증 도입 검토(`clone({ ownerPrefix })`)

## C. Continued Conversation(연속 대화) 연결 규칙
- [ ] `user_message` path = `[rootId, executionId]` 보장
- [ ] `response(last same root)` → `user_message(continues)` → `thinking(processes)` 시퀀스 보장

## D. Tools DnD 확장(웹)
- [ ] 사이드바 툴 목록 상태 관리(추가/삭제/정렬/검증)
- [ ] `+ Add Tool` 모달 및 유효성
- [ ] 빠른 연속 드롭 디바운스/중복 방지
- [ ] UI 오버레이 상태 `addedToolsByAgent` 도입 및 병합 규칙 반영
- [ ] 성공/실패 토스트 표준화

## E. 브릿지/레지스트리 개선(웹)
- [ ] executor 에러를 UI 표준 에러로 변환
- [ ] 케이스 26/27 가드 명령과 검증 스크립트 자동화(개발 편의)

## F. 검증/가드(반드시 수동 확인)
- [ ] 예제 26 가드 → 검증 스크립트 통과(STRICT-POLICY/EDGE-ORDER-VIOLATION 0)
- [ ] 연속 대화 샘플(예: 27) 시퀀스/연결 규칙 준수


## G. Playground / Workflow 레이어 분리(웹)
- [ ] `apps/web/src/playground/`와 `apps/web/src/workflow/` 베이스 폴더 생성
- [ ] `playground/components/PlaygroundApp.tsx`, `workflow/components/WorkflowView.tsx` 추가
- [ ] `playground/index.ts`, `workflow/index.ts`로 외부 공개 표면 정리
- [ ] `src/lib/playground/*` → `playground/core|services|state|hooks|components`로 이전
- [ ] `playground/services/WorkflowBridgeService.ts`, `PlaygroundEventService.ts` 도입
- [ ] `workflow/core/adapters/SubscriberAdapter.ts`, `workflow/utils/converters.ts` 도입
- [ ] `app/playground/page.tsx`에서 `PlaygroundApp`만 import하여 렌더
- [ ] 마이그레이션 완료 후 `src/lib/playground/*` 경로 import 제거
- [ ] 정적 import 강제, 이벤트 상수 사용(하드코딩 금지) 확인
- [ ] converters/adapters에서 Path-Only/소스-오브-트루스 준수 재검증
