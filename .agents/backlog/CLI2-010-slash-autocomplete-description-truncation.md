---
title: 'CLI2-010: 슬래시 자동완성 설명 텍스트 한 줄 말줄임표 처리'
status: done
created: 2026-05-11
priority: medium
urgency: normal
area: tui
source: user-feedback-2026-05-11
---

## Problem

TUI 입력창에서 `/`를 입력하면 커맨드/스킬 자동완성 팝업이 표시된다. 각 항목의 description이
길 경우 여러 줄로 줄바꿈되어 팝업 높이가 크게 늘어나고 레이아웃이 어수선해진다.

`packages/agent-transport-tui/src/SlashAutocomplete.tsx:33`:

```tsx
{
  showSlash ? `/${cmd.name}  ${cmd.description}` : cmd.description;
}
```

description 텍스트에 길이 제한이 없어 그대로 렌더링된다.

## Required Change

`CommandRow`에서 description을 한 줄 최대 길이로 잘라 말줄임표(`…`)를 붙인다.
터미널 폭을 동적으로 알기 어려우므로, 합리적인 고정 최대 문자 수(예: 60자)를 상수로 정의하고
초과하면 슬라이스 + `…`로 처리한다.

```tsx
const MAX_DESC_LENGTH = 60;

function truncate(text: string): string {
  return text.length > MAX_DESC_LENGTH ? `${text.slice(0, MAX_DESC_LENGTH)}…` : text;
}
```

`CommandRow` 내부에서 `cmd.description` 대신 `truncate(cmd.description ?? '')` 사용.

## Scope

- `packages/agent-transport-tui/src/SlashAutocomplete.tsx` — `CommandRow` + `truncate` 헬퍼 추가

## Test Plan

1. `SlashAutocomplete` 단위 테스트: 60자 초과 description이 말줄임표로 잘려 렌더링되는지 확인
2. 60자 이하 description은 변경 없이 렌더링되는지 확인
3. `pnpm typecheck` 통과
4. `pnpm --filter @robota-sdk/agent-transport-tui test` 회귀 없음

## User Execution Test Scenarios

### 시나리오 1: 슬래시 자동완성 팝업 한 줄 표시 확인

**agent-executability**: `agent-executable`

**전제조건**: `agent-cli` 빌드 완료 (`pnpm --filter @robota-sdk/agent-cli build`)

**실행 단계**:

```bash
node packages/agent-cli/dist/node/bin.js -p "TRUNCATION_CHECK_CLI2010" --no-session-persistence 2>&1 | head -5
```

(비-인터랙티브 경로로 실행 → 자동완성 UI는 TTY 없이 기동 불가이므로, 렌더링 로직 단위 테스트로 보완)

> **보완 시나리오 — 단위 테스트 직접 실행**:
>
> ```bash
> pnpm --filter @robota-sdk/agent-transport-tui test -- --testPathPattern SlashAutocomplete
> ```
>
> 예상 결과: `truncate` 헬퍼 테스트 통과, 60자 초과 description이 `…`로 잘림 확인됨

**기대 결과**: 단위 테스트 전부 PASS, 60자 초과 description이 한 줄로 잘림

**증거 필드** (구현 후 기입):

- 관찰 결과: `pnpm --filter @robota-sdk/agent-transport-tui test SlashAutocomplete` — 8개 테스트 PASS. truncate 헬퍼: 60자 초과 → `…` 잘림, 60자 이하 → 변경 없음. 전체 38파일 319테스트 회귀 없음.
- 종료 코드: 0
