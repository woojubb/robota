---
title: 'CLI-B03: 터미널 리사이즈 시 로고가 여러 번 반복 표시됨 — ARCH-003 회귀'
status: done
created: 2026-05-31
completed: 2026-05-31
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

## 원인 분석

Ink v7의 resize 핸들러는 이전 출력 높이(lastOutputHeight)를 기반으로 커서를 위로 이동하여 이전 내용을 지운다. 터미널 너비 변경 시 텍스트 wrapping으로 실제 렌더링 라인 수가 달라지면 lastOutputHeight와 불일치가 발생한다. 이 경우 이전 로고가 지워지지 않고 남아있는 상태에서 새 로고가 그 아래에 렌더링되어 로고가 두 번 보인다.

ARCH-003 이전에는 로고가 dynamic content에 포함되어 있어도 세션이 React 훅 안에서 생성되었기 때문에 첫 렌더가 안정적이었다. ARCH-003 이후 channel이 React 외부에서 생성되면서 초기화 이벤트가 React 렌더 전에 발화될 수 있게 되어 증상이 두드러졌다.

## 해결 방법

Ink의 `<Static>` 컴포넌트로 로고를 감쌌다. `<Static>`은 아이템을 처음 한 번만 "정적 출력"으로 기록하고 이후 dynamic re-render 시 절대 지워지지 않는다. resize 시 dynamic 컨텐츠만 재렌더되고 로고는 터미널 스크롤백에 단 한 번 유지된다.

## Done gate

- [x] 회귀 원인 특정 완료 (Ink의 eraseLines 높이 불일치 + Static 분리로 해결)
- [x] `pnpm --filter @robota-sdk/agent-transport test` 전체 통과 (450/450)
- [ ] 실제 TUI 실행 후 터미널 리사이즈 시 로고 중복 없음 확인 (User Execution 필요)

## User Execution Test Scenarios

### Scenario 1: 터미널 리사이즈 테스트

1. `pnpm robota` 실행
2. 터미널 창 크기를 변경 (드래그 또는 단축키)
3. **기대**: 화면이 리사이즈되고 로고는 한 번만 표시됨. 중복 렌더링 없음
