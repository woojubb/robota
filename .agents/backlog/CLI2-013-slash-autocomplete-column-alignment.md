---
title: 'CLI2-013: 슬래시 자동완성 name/description 컬럼 정렬'
status: todo
created: 2026-05-11
priority: low
urgency: normal
area: tui
source: user-feedback-2026-05-11
---

## Problem

현재 각 행의 description 시작 위치가 name 길이마다 달라 가독성이 떨어진다.

```
▸ /help  Show available commands
  /session-persistence  Manage session...
  /go  Run
```

## Required Change

팝업에 보이는 커맨드(`visibleCommands`) 기준으로 name 컬럼 폭을 계산하고,
name이 최대 폭을 초과하면 `…`로 자른 뒤 모든 행의 description을 같은 열에 맞춘다.

**계산 방식:**

```
NAME_COL_MAX = 20          // name 컬럼 최대 폭 (캡)
nameColWidth = Math.min(NAME_COL_MAX, max(visibleCommands.map(c => c.name.length)))
namePart     = name.length > nameColWidth
                 ? name.slice(0, nameColWidth - 1) + '…'
                 : name.padEnd(nameColWidth)
row          = `${indicator}/${namePart}  ${description}`
```

wrap="truncate-end" + Box width는 CLI2-012 구현 그대로 유지.

**예시 결과:**

```
╭──────────────────────────────────────────────────╮
│ ▸ /help               Show available commands... │
│   /session-persiste…  Manage session persist...  │
│   /go                 Run                        │
╰──────────────────────────────────────────────────╯
```

## Scope

- `packages/agent-transport-tui/src/SlashAutocomplete.tsx`
  - `SlashAutocomplete`에서 `visibleCommands` 기준 `nameColWidth` 계산
  - `CommandRow`에 `nameColWidth` prop 추가
  - name 캡 + padEnd 처리 후 description과 조합

## Test Plan

1. 짧은/긴 이름 혼합 시 description이 같은 열에 시작하는지 확인
2. name이 20자 초과 시 `…`로 잘리는지 확인
3. 모든 name이 짧을 때 nameColWidth가 max name 길이로 설정되는지 확인
4. `pnpm typecheck` 통과
5. `pnpm --filter @robota-sdk/agent-transport-tui test` 회귀 없음

## User Execution Test Scenarios

### 시나리오 1: 단위 테스트 실행

**agent-executability**: `agent-executable`

**실행 단계**:

```bash
pnpm --filter @robota-sdk/agent-transport-tui test SlashAutocomplete
```

**기대 결과**: 전체 테스트 PASS. name 컬럼 정렬 및 캡 동작 확인.

**증거 필드** (구현 후 기입):

- 관찰 결과: \_
- 종료 코드: \_
