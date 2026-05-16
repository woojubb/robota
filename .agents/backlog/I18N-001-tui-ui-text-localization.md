---
title: 'I18N-001: TUI UI 텍스트 i18n — agent-cli / agent-transport 하드코딩 문자열 로컬라이제이션'
status: backlog
created: 2026-05-17
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-transport, packages/agent-cli
depends_on: []
---

## Problem

TUI와 CLI 전반에 걸쳐 사용자에게 표시되는 문자열이 영어로 하드코딩되어 있다.
`language` 설정은 현재 AI 응답 언어만 제어하며, UI 자체는 번역되지 않는다.

## Architecture Decision (확정)

### 계층 분리 원칙

```
agent-core           → 번역 파일 없음 (타입·프리미티브만)
agent-framework      → i18n engine만 소유 (createTranslator 함수)
agent-session/etc.   → 번역 파일 없음 (SDK 인프라, UI 문자열 없음)
─────────────────────────── 이 선 아래에 번역 파일 없음
agent-command        → 번역 파일 없음 (command description은 이번 범위 제외)
agent-transport      → TUI catalog 소유 (en/ko)
agent-cli            → CLI catalog 소유 (en/ko)
```

**규칙**: `agent-framework` 하위 패키지에는 번역 파일을 두지 않는다.

### i18n Engine (`agent-framework`)

```typescript
// agent-framework/src/i18n/createTranslator.ts
export type TLocale = 'en' | 'ko';

export function createTranslator<T extends Record<string, string>>(
  catalogs: Partial<Record<TLocale, T>>,
  fallback: TLocale = 'en',
) {
  return function t(locale: TLocale | string | undefined, key: keyof T & string): string {
    const lang = (locale ?? fallback) as TLocale;
    const catalog = catalogs[lang] ?? catalogs[fallback];
    return catalog?.[key] ?? key;
  };
}
```

- 외부 라이브러리 없음 — 순수 TypeScript, zero 추가 deps
- 번역 키 누락 시 key 자체를 fallback으로 반환
- `en` fallback 고정

### language 전달 방식

`language`는 이미 `IRenderOptions` → `App` → 각 컴포넌트로 props를 통해 흐른다.
React Context 없이 기존 props 체인 그대로 사용한다.

### 번역 범위

- **포함**: TUI 고정 UI 문자열 (네비게이션 힌트, placeholder, confirm 메시지, picker 레이블)
- **제외**: `ICommand.description` (agent-command 계층, 별도 작업)
- **제외**: AI 응답 텍스트, 동적 에러 메시지 (파일명·값이 보간되는 문자열)

---

## Translation Plan

### Package 1: `agent-transport` — TUI catalog

**파일**: `packages/agent-transport/src/tui/i18n/catalog.ts`

**대상 문자열 전수 목록**:

| key                         | 위치                                 | en                                        |
| --------------------------- | ------------------------------------ | ----------------------------------------- |
| `menuNavigationHint`        | `MenuSelect.tsx:100`                 | `↑↓ Navigate  Enter Select  Esc Back`     |
| `menuLoading`               | `MenuSelect.tsx:78`                  | `Loading...`                              |
| `menuPressEscBack`          | `MenuSelect.tsx:84`                  | `Press Esc to go back`                    |
| `pickerNavigationHint`      | `interactions/CommandPicker.tsx:73`  | `↑↓ navigate · Enter select · Esc cancel` |
| `confirmYesNo`              | `interactions/CommandConfirm.tsx:32` | `[y/n]`                                   |
| `inputPlaceholder`          | `InputArea.tsx:347`                  | `Type a message or /help`                 |
| `pluginAddMarketplaceTitle` | `PluginTUI.tsx:178`                  | `Add Marketplace Source`                  |

**번역본**:

```typescript
const catalogs = {
  en: {
    menuNavigationHint: '↑↓ Navigate  Enter Select  Esc Back',
    menuLoading: 'Loading...',
    menuPressEscBack: 'Press Esc to go back',
    pickerNavigationHint: '↑↓ navigate · Enter select · Esc cancel',
    confirmYesNo: '[y/n]',
    inputPlaceholder: 'Type a message or /help',
    pluginAddMarketplaceTitle: 'Add Marketplace Source',
  },
  ko: {
    menuNavigationHint: '↑↓ 이동  Enter 선택  Esc 뒤로',
    menuLoading: '로딩 중...',
    menuPressEscBack: 'Esc로 뒤로 가기',
    pickerNavigationHint: '↑↓ 이동 · Enter 선택 · Esc 취소',
    confirmYesNo: '[y/n]',
    inputPlaceholder: '메시지 또는 /help 입력',
    pluginAddMarketplaceTitle: '마켓플레이스 소스 추가',
  },
} as const;
```

---

### Package 2: `agent-cli` — CLI catalog

**파일**: `packages/agent-cli/src/i18n/catalog.ts`

**대상 문자열 전수 목록**:

| key                        | 위치                              | en                            |
| -------------------------- | --------------------------------- | ----------------------------- |
| `confirmExit`              | `tui-interactions/registry.ts:75` | `Exit the session?`           |
| `confirmClear`             | `tui-interactions/registry.ts:71` | `Clear conversation history?` |
| `modeItemPlanLabel`        | `tui-interactions/registry.ts:35` | `plan`                        |
| `modeItemPlanDesc`         | `tui-interactions/registry.ts:35` | `Plan only, no execution`     |
| `modeItemDefaultLabel`     | `tui-interactions/registry.ts:36` | `default`                     |
| `modeItemDefaultDesc`      | `tui-interactions/registry.ts:36` | `Ask before risky actions`    |
| `modeItemAcceptEditsLabel` | `tui-interactions/registry.ts:37` | `acceptEdits`                 |
| `modeItemAcceptEditsDesc`  | `tui-interactions/registry.ts:37` | `Auto-approve file edits`     |
| `modeItemBypassLabel`      | `tui-interactions/registry.ts:39` | `bypassPermissions`           |
| `modeItemBypassDesc`       | `tui-interactions/registry.ts:41` | `Skip all permission checks`  |
| `providerItemCurrentDesc`  | `tui-interactions/registry.ts:57` | `Show current provider`       |
| `providerItemListDesc`     | `tui-interactions/registry.ts:58` | `List available providers`    |
| `providerItemUseDesc`      | `tui-interactions/registry.ts:59` | `Switch to a provider`        |
| `providerItemAddDesc`      | `tui-interactions/registry.ts:60` | `Add a new provider`          |
| `providerItemTestDesc`     | `tui-interactions/registry.ts:61` | `Test provider connection`    |

> 참고: language picker 항목(ko/en 레이블)은 언어 자체의 고유명사이므로 번역 대상 제외.
> mode/provider의 value 값(`'plan'`, `'current'` 등)은 명령어 인수이므로 번역 대상 제외.

**번역본**:

```typescript
const catalogs = {
  en: {
    confirmExit: 'Exit the session?',
    confirmClear: 'Clear conversation history?',
    modeItemPlanLabel: 'plan',
    modeItemPlanDesc: 'Plan only, no execution',
    modeItemDefaultLabel: 'default',
    modeItemDefaultDesc: 'Ask before risky actions',
    modeItemAcceptEditsLabel: 'acceptEdits',
    modeItemAcceptEditsDesc: 'Auto-approve file edits',
    modeItemBypassLabel: 'bypassPermissions',
    modeItemBypassDesc: 'Skip all permission checks',
    providerItemCurrentDesc: 'Show current provider',
    providerItemListDesc: 'List available providers',
    providerItemUseDesc: 'Switch to a provider',
    providerItemAddDesc: 'Add a new provider',
    providerItemTestDesc: 'Test provider connection',
  },
  ko: {
    confirmExit: '세션을 종료할까요?',
    confirmClear: '대화 내역을 지울까요?',
    modeItemPlanLabel: 'plan',
    modeItemPlanDesc: '계획만, 실행 없음',
    modeItemDefaultLabel: 'default',
    modeItemDefaultDesc: '위험한 작업 전 확인',
    modeItemAcceptEditsLabel: 'acceptEdits',
    modeItemAcceptEditsDesc: '파일 편집 자동 승인',
    modeItemBypassLabel: 'bypassPermissions',
    modeItemBypassDesc: '모든 권한 확인 건너뜀',
    providerItemCurrentDesc: '현재 프로바이더 보기',
    providerItemListDesc: '사용 가능한 프로바이더 목록',
    providerItemUseDesc: '프로바이더 전환',
    providerItemAddDesc: '새 프로바이더 추가',
    providerItemTestDesc: '프로바이더 연결 테스트',
  },
} as const;
```

---

## Scope

- [ ] `agent-framework/src/i18n/createTranslator.ts` 구현 및 export
- [ ] `agent-framework/docs/SPEC.md` i18n engine 섹션 추가
- [ ] `agent-transport/src/tui/i18n/catalog.ts` 작성 (en/ko, 위 번역본 기준)
- [ ] agent-transport TUI 컴포넌트 전수 적용: `MenuSelect`, `InputArea`, `CommandPicker`, `CommandConfirm`, `PluginTUI`
- [ ] `agent-cli/src/i18n/catalog.ts` 작성 (en/ko, 위 번역본 기준)
- [ ] agent-cli `tui-interactions/registry.ts` 번역 적용
- [ ] `agent-transport/docs/SPEC.md`, `agent-cli/docs/SPEC.md` i18n 섹션 추가

## Test Plan

- [ ] typecheck 전체 통과
- [ ] 번역 키가 TypeScript 타입으로 강제됨 확인 (존재하지 않는 키 사용 시 컴파일 에러)
- [ ] `createTranslator` 단위 테스트: ko/en 반환값, 미지원 언어 en fallback 확인
- [ ] TUI 컴포넌트 렌더링 테스트: language=ko 시 한국어 문자열 렌더링 확인
- [ ] `agent-framework` 하위 패키지에 번역 파일 없음 확인

## User Execution Test Scenarios

### Scenario 1: language=ko 설정 시 TUI UI 한국어 표시

**Prerequisites**: `~/.robota/settings.json`에 `{ "language": "ko" }` 설정

**Steps**:

```
robota 실행 → TUI 진입
/ 입력 → autocomplete 표시
/mode 선택 (Enter) → picker 오픈
```

**Expected**: placeholder("메시지 또는 /help 입력"), 네비게이션 힌트, picker 메시지가 한국어로 표시

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 2: language=en 설정 시 영어 표시 (기본 동작 유지)

**Steps**:

```
language=en 설정 후 동일 흐름
```

**Expected**: 기존 영어 문자열과 동일

**Evidence**: _(구현 완료 후 스크린샷)_

### Scenario 3: 번역 키 누락 시 fallback

**Expected**: 번역 없는 언어는 영어(en) fallback으로 표시, 런타임 오류 없음

**Evidence**: _(단위 테스트 확인)_
