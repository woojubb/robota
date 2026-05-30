---
title: 'CLI-B03: 터미널 리사이즈 시 로고가 여러 번 반복 표시됨 — ARCH-003 회귀'
status: todo
created: 2026-05-31
priority: critical
urgency: now
area: packages/agent-transport, packages/agent-cli
regression_introduced_by: ARCH-003 (PR #640 p5, PR #641 p6)
---

## 증상

터미널 창 크기를 변경(리사이즈)하면 CLI 로고(시작 화면)가 여러 번 반복해서 렌더링된다.

## 회귀 원인 분석 (가설)

ARCH-003-p5/p6에서 `TuiInteractionChannel`이 세션 소유권을 가지게 되고 `renderApp()`이 직접 호출되도록 변경됐다.

가능한 원인:

1. `TuiInteractionChannel.onChange` 콜백이 terminal resize 이벤트마다 발화되고, 이때 전체 App이 재마운트(unmount→mount)되어 로고가 다시 렌더링됨
2. `renderApp()` 내부에서 resize 이벤트를 처리하는 방식이 변경되어 Ink 인스턴스가 여러 개 생성됨
3. Ink의 `render()` 함수가 resize 시 새 인스턴스를 생성하도록 호출되는 경우

## 조사 순서

1. `packages/agent-transport/src/tui/renderApp.ts` — resize 이벤트 핸들링 확인
2. `packages/agent-transport/src/tui/TuiInteractionChannel.ts` — `onChange` 발화 빈도 및 조건 확인
3. `packages/agent-transport/src/tui/App.tsx` — 로고 컴포넌트 렌더링 조건 확인
4. 기존 `TuiTransport.start()` → Ink `render()` 방식과 비교

## Done gate

- [ ] 회귀 원인 특정 완료
- [ ] `pnpm --filter @robota-sdk/agent-transport test` 전체 통과
- [ ] 실제 TUI 실행 후 터미널 리사이즈 시 로고 중복 없음 확인

## User Execution Test Scenarios

### Scenario 1: 터미널 리사이즈 테스트

1. `pnpm robota` 실행
2. 터미널 창 크기를 변경 (드래그 또는 단축키)
3. **기대**: 화면이 리사이즈되고 로고는 한 번만 표시됨. 중복 렌더링 없음
