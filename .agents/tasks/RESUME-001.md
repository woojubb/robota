# RESUME-001 Tasks — 세션 리줌 컨텍스트 복구 검증

Spec: `.agents/spec-docs/active/RESUME-001-session-resume-context-verification.md`

## Implementation Tasks

- [ ] T-01: `IInteractiveSessionRecord`에 `usedTokens?: number` 필드 추가 (타입 파일 위치 확인 후)
- [ ] T-02: `ContextWindowTracker.restoreUsedTokens(n: number)` 메서드 추가
- [ ] T-03: `persistSession()`에서 `usedTokens` 저장 포함
- [ ] T-04: `loadSessionRecord()` 반환에 `usedTokens` 포함
- [ ] T-05: `restoreSessionRecordIfNeeded()`에서 `restoreUsedTokens()` 호출

## Test Tasks

- [ ] T-06: TC-01 — contextReferences 저장→리줌 라운드트립 테스트
- [ ] T-07: TC-02 — 리줌 직후 `getContextState().usedTokens` 복원값 단언
- [ ] T-08: TC-03 — 첫 submit 후 `getContextState().usedTokens` 갱신 테스트
- [ ] T-09: TC-04 — 리줌 후 `/context list` refs 결합 단언
- [ ] T-10: TC-05 — 리줌 후 `provider.chat()` messages 구조 검증
- [ ] T-11: TC-06 — `listInjectionContextReferences()` 중복 주입 방지 테스트

## Verification Tasks

- [ ] T-12: `pnpm --filter @robota-sdk/agent-session test` 전체 통과
- [ ] T-13: `pnpm --filter @robota-sdk/agent-framework test` 전체 통과
- [ ] T-14: `pnpm typecheck` 통과
