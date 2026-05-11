---
title: 'CLI2-011: 슬래시 자동완성 행 전체 폭 기준 말줄임표 처리'
status: todo
created: 2026-05-11
priority: medium
urgency: normal
area: tui
source: user-feedback-2026-05-11
---

## Problem

CLI2-010에서 description을 고정 60자로 자르는 방식을 적용했지만,
행의 실제 표시 내용은 `/<name>  <description>` 형태이기 때문에
명령어 이름 길이가 다르면 행마다 총 길이가 제각각으로 보인다.

예시:

```
▸ /help  Short help text              ← 짧은 이름, 설명이 길어도 여유 있음
  /session-persistence  This is a ...  ← 긴 이름, 설명이 조금만 길어도 넘침
```

## Required Change

description만 자르는 것이 아니라, 행 전체(`/<name>  <description>`)의 총 길이를
기준으로 설명 부분을 동적으로 잘라야 한다.

**계산 방식:**

- 행 prefix 길이 = `indicator(2) + slash(1) + name.length + separator(2)` = `name.length + 5`
- 허용 description 길이 = `MAX_ROW_LENGTH - prefix 길이`
- 허용 길이 이하면 그대로, 초과하면 슬라이스 + `…`

```tsx
const MAX_ROW_LENGTH = 72; // 합리적인 터미널 폭 기준

function truncateDesc(name: string, description: string, showSlash: boolean): string {
  const prefixLen = showSlash
    ? 2 + 1 + name.length + 2 // indicator + '/' + name + '  '
    : 2 + name.length + 2; // indicator + name + '  ' (subcommand mode)
  const allowed = Math.max(10, MAX_ROW_LENGTH - prefixLen);
  return description.length > allowed ? `${description.slice(0, allowed)}…` : description;
}
```

`CommandRow`에서 기존 `truncate(cmd.description ?? '')` 대신
`truncateDesc(cmd.name, cmd.description ?? '', showSlash)` 사용.

## Scope

- `packages/agent-transport-tui/src/SlashAutocomplete.tsx`
  - `MAX_DESC_LENGTH` + `truncate` 제거 → `MAX_ROW_LENGTH` + `truncateDesc` 교체

## Test Plan

1. 짧은 이름(`/help`)과 긴 이름(`/session-persistence`) 모두 총 행 길이가 `MAX_ROW_LENGTH` 이하인지 확인
2. `subcommand` 모드(슬래시 없음)에서도 올바르게 계산되는지 확인
3. `allowed < 10` 경우(이름이 매우 긴 경우) 최소 10자는 보장되는지 확인
4. `pnpm typecheck` 통과
5. `pnpm --filter @robota-sdk/agent-transport-tui test` 회귀 없음

## User Execution Test Scenarios

### 시나리오 1: 행 폭 균일 확인 (단위 테스트)

**agent-executability**: `agent-executable`

**실행 단계**:

```bash
pnpm --filter @robota-sdk/agent-transport-tui test SlashAutocomplete
```

**기대 결과**: 짧은/긴 명령어 이름 모두 행 총 길이가 MAX_ROW_LENGTH 이하로 렌더링됨. 전체 테스트 PASS.

**증거 필드** (구현 후 기입):

- 관찰 결과: \_
- 종료 코드: \_
