---
title: 'CLI-B02: AI 대화 응답이 화면에 표시되지 않음 — ARCH-003 회귀'
status: done
created: 2026-05-31
priority: critical
urgency: now
area: packages/agent-transport, packages/agent-cli
regression_introduced_by: ARCH-003 (PR #640 p5, PR #641 p6)
---

## 증상

`agent-cli` TUI 모드에서:

- **slash command(`/help`, `/context` 등)는 정상 동작** — 입력 처리 자체는 살아 있음
- **AI 대화 응답이 화면에 표시되지 않음** — 프롬프트 입력 후 AI 응답이 MessageList에 나타나지 않음

## 원인 좁히기

slash command가 동작한다는 것은:

- `handleSubmit` → `session.executeCommand()` 경로는 정상
- `TuiInteractionChannel`과 React 간 기본 연결은 살아 있음

AI 응답 표시가 안 되는 것은 다음 중 하나:

1. **`text_delta` / `complete` 이벤트가 `onChange`로 전파되지 않음** — `TuiInteractionChannel`이 세션 이벤트를 수신하지만 `TuiStateManager.notify()` 호출 누락 또는 `useTuiChannel`의 구독이 끊어짐
2. **`history` state가 업데이트되지 않음** — `TuiStateManager`가 `getFullHistory()`를 호출하지 않거나 `onComplete` 핸들러에서 state sync 누락
3. **`MessageList`가 빈 history를 받음** — `useTuiChannel`이 반환하는 `history` prop이 항상 `[]`
4. **`session.submit()` 자체가 호출되지 않음** — slash command는 `executeCommand()`를 쓰지만 일반 프롬프트는 `submit()`을 쓰는데, 이 경로의 연결 누락

## 조사 순서

1. `packages/agent-transport/src/tui/TuiInteractionChannel.ts`
   - `on('text_delta')`, `on('complete')` 핸들러에서 `notify()` 호출 여부
   - `handleSubmit` → `this.session.submit()` 경로

2. `packages/agent-transport/src/tui/useTuiChannel.ts`
   - `channel.onChange(cb)` 구독 및 `setState` 연결 확인
   - `history` 값이 실제로 업데이트되는지

3. `packages/agent-transport/src/tui/App.tsx`
   - `useTuiChannel`에서 받은 `history`가 `MessageList`에 전달되는지
   - `handleSubmit`이 일반 프롬프트에 연결되어 있는지

4. (비교) 이전 `useInteractiveSession` hook의 동일 경로와 차이점 확인

## Done gate

- [ ] 회귀 원인 특정 및 수정 완료
- [ ] `pnpm --filter @robota-sdk/agent-transport test` 전체 통과
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- [ ] 실제 TUI 실행 후 AI 응답이 정상 표시됨

## User Execution Test Scenarios

### Scenario 1: AI 대화 응답 표시

1. `pnpm robota` 실행
2. "hello" 입력 후 Enter
3. **기대**: AI 응답이 MessageList에 정상 표시됨

### Scenario 2: slash command 정상 유지

1. `/help` 입력
2. **기대**: help 내용 표시됨 (회귀 없음)
