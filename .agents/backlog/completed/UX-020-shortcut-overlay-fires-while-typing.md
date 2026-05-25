---
title: 'UX-020: ? 단축키 오버레이 제거 — 타이핑 중 발동 버그'
status: done
created: 2026-05-25
completed: 2026-05-25
priority: high
urgency: now
area: packages/agent-transport
depends_on: [UX-018]
---

## Background

UX-018에서 구현한 `?` 키 Keyboard Shortcuts 오버레이가 첫 프롬프트 입력 시 발동한다.
Ink의 `useInput`은 전역 키 이벤트를 수신하므로 InputArea 타이핑 중에도 `?` 키가 오버레이를
열어 입력을 차단한다. 기능 자체가 복잡성 대비 가치가 낮으므로 전체 제거한다.

## 작업 항목

- App.tsx: `showShortcutOverlay` 상태, `?` useInput 핸들러 제거
- App.tsx: `<KeyboardShortcutOverlay>` 렌더링 제거
- App.tsx: `KeyboardShortcutOverlay` import 제거
- App.tsx: `isDisabled` 조건에서 `showShortcutOverlay` 참조 제거

## Test Plan

- `pnpm run cli:dev` 실행 후 `?` 단독 입력 → 오버레이 미표시 확인
- `hello?` 입력 후 Enter → 메시지 정상 제출 확인
- `pnpm --filter @robota-sdk/agent-transport test` 통과

## User Execution Test Scenarios

### TC-01: ? 입력 시 오버레이 미발동

**Steps:** `pnpm run cli:dev` 실행 → 입력창에 `?` 입력

**Expected:** 오버레이 미표시, `?` 문자가 입력창에 표시됨

**Evidence:** App.tsx에서 showShortcutOverlay 상태 및 ? 핸들러 제거 완료
