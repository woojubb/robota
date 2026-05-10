---
title: 'CLI2-012: 슬래시 자동완성 행 잘림을 Ink wrap="truncate-end"로 교체'
status: todo
created: 2026-05-11
priority: medium
urgency: normal
area: tui
source: user-feedback-2026-05-11
---

## Problem

CLI2-011에서 구현한 수동 `truncateDesc()` 방식은 prefix 길이 계산 수식이 필요하고,
`MAX_ROW_LENGTH` 상수와 로직이 컴포넌트 외부에 별도로 존재해 유지보수 부담이 있다.

Ink 7은 `Text` 컴포넌트에 `wrap="truncate-end"` prop을 공식 지원하며,
`Box`에 `width`를 지정하면 박스 경계에서 자동으로 `…`를 붙여 잘라준다.
이를 활용하면 수식 없이 선언적으로 동일한 결과를 얻을 수 있다.

## Required Change

`SlashAutocomplete.tsx`에서:

1. `MAX_ROW_LENGTH`, `truncateDesc` 제거
2. `CommandRow`의 `Box`에 `width={ROW_WIDTH}` 추가
3. `Text`에 `wrap="truncate-end"` 추가
4. description을 그대로 전달 (수동 슬라이스 없음)

```tsx
const ROW_WIDTH = 76; // border(2) + paddingX(2) + content(72)

function CommandRow({ cmd, isSelected, showSlash }: CommandRowProps): React.ReactElement {
  const indicator = isSelected ? '▸ ' : '  ';
  const nameColor = isSelected ? 'cyan' : undefined;
  const dimmed = !isSelected;
  const text = showSlash
    ? `${indicator}/${cmd.name}  ${cmd.description ?? ''}`
    : `${indicator}${cmd.name}  ${cmd.description ?? ''}`;

  return (
    <Box width={ROW_WIDTH}>
      <Text color={nameColor} dimColor={dimmed} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  );
}
```

> **주의**: 외부 `Box`의 `borderStyle="round"` + `paddingX={1}`이 각 2자씩 소비하므로
> `ROW_WIDTH`는 실질적인 content 폭(72) + 4 = 76으로 설정한다.
> 실제 터미널 폭과 비교해 맞지 않으면 `process.stdout.columns`를 참고해 조정할 수 있으나,
> 우선 고정값으로 시작한다.

## Scope

- `packages/agent-transport-tui/src/SlashAutocomplete.tsx`
  - `MAX_ROW_LENGTH`, `truncateDesc` 삭제
  - `CommandRow` Box에 `width={ROW_WIDTH}` 추가
  - `Text`에 `wrap="truncate-end"` 추가

## Test Plan

1. `ink-testing-library`는 가상 터미널에서 렌더링하므로, Box `width` 기반 잘림이 테스트에서도 동작하는지 확인 필요
   - 동작하면: 기존 `truncateDesc` 기반 테스트를 Box width 기반으로 교체
   - 동작 안 하면: `wrap="truncate-end"` 렌더링 확인은 통합 테스트 또는 수동 확인으로 대체하고, 단위 테스트는 "description이 그대로 전달된다"로 조정
2. `pnpm typecheck` 통과
3. `pnpm --filter @robota-sdk/agent-transport-tui test` 회귀 없음

## User Execution Test Scenarios

### 시나리오 1: 단위 테스트 실행

**agent-executability**: `agent-executable`

**실행 단계**:

```bash
pnpm --filter @robota-sdk/agent-transport-tui test SlashAutocomplete
```

**기대 결과**: 전체 테스트 PASS. Ink `wrap="truncate-end"` 동작 확인.

**증거 필드** (구현 후 기입):

- 관찰 결과: \_
- 종료 코드: \_
