# BEHAVIOR-001 Tasks

Spec: `.agents/spec-docs/active/BEHAVIOR-001-session-resume-restore.md`

## Tasks

- [x] T-01: `interactive-session-restore.ts` — `injectSavedMessage`를 `session.injectRawMessage(msg)` 위임으로 교체
- [x] T-02: `robota-history.ts` — `injectRawMessage()` 함수 추가 (conversationStore.addMessage 직접 호출)
- [x] T-03: `robota.ts` + `session-base.ts` — `injectRawMessage(msg: TUniversalMessage)` 메서드 체인 추가
- [x] T-04: `interactive-session.test.ts` — TC-01, TC-02: tool_use+tool_result 쌍 구조체 형태 검증 및 messages 배열 길이 일치 테스트 추가
- [x] T-05: `history-cross-package.test.ts` — TC-03/T-08: round-trip으로 LLM 전달 messages에 복구 history 포함 검증
- [x] T-06: `interactive-session.test.ts` — TC-04, TC-05: history turn count 일치 및 sessionName 복구 검증 테스트 추가
- [x] T-07: `interactive-session.test.ts` — TC-06: multi-turn(3회 이상) tool 호출 포함 세션 resume 시 pairing 유지 검증 테스트 추가
- [x] T-08: `history-cross-package.test.ts` — TC-03/T-08: tool_use+tool_result 쌍 round-trip 검증 테스트 추가
- [x] T-09: `pnpm --filter @robota-sdk/agent-framework test` 전체 통과 — 872 passed (TC-07)
- [x] T-10: `pnpm typecheck` 통과 — no errors (TC-08)
