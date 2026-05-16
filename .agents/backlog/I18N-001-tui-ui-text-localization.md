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
`language` 설정(`ko`/`en`/`ja`/`zh`)은 현재 AI 응답 언어만 제어하며, UI 자체는 번역되지 않는다.

### 하드코딩 문자열 분포 (대표 예시)

| 위치                                                      | 문자열                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `agent-transport/src/tui/MenuSelect.tsx`                  | "Loading...", "Press Esc to go back", "↑↓ Navigate Enter Select Esc Back"      |
| `agent-transport/src/tui/InputArea.tsx`                   | "Type a message or /help" (placeholder)                                        |
| `agent-transport/src/tui/interactions/CommandConfirm.tsx` | "[y/n]"                                                                        |
| `agent-transport/src/tui/interactions/CommandPicker.tsx`  | "↑↓ navigate · Enter select · Esc cancel"                                      |
| `agent-transport/src/tui/PluginTUI.tsx`                   | "Add Marketplace Source"                                                       |
| `agent-cli/src/tui-interactions/registry.ts`              | "Exit the session?", "Clear conversation history?", picker labels/descriptions |

## Architecture Decision (확정)

### 계층 분리 원칙

```
agent-core           → 번역 파일 없음 (타입·프리미티브만)
agent-framework      → i18n engine만 소유 (createTranslator 함수)
agent-session/etc.   → 번역 파일 없음 (SDK 인프라, UI 문자열 없음)
─────────────────────────── 이 선 아래에 번역 파일 없음
agent-command        → 번역 파일 없음 (command description은 이번 범위 제외)
agent-transport      → TUI catalog 소유 (ko/en/ja/zh)
agent-cli            → CLI catalog 소유 (ko/en/ja/zh)
```

**규칙**: `agent-framework` 하위 패키지에는 번역 파일을 두지 않는다.
번역 파일이 필요한 사용자 노출 텍스트는 반드시 framework 상위 계층(transport, cli)에서만 발생해야 한다.

### i18n Engine (`agent-framework`)

`agent-framework`은 이미 `IResolvedConfig.language`를 소유한다.
"어떤 언어를 쓸지"(설정)와 "그 언어로 어떻게 번역하는지"(엔진)를 같은 패키지에 둔다.

```typescript
// agent-framework/src/i18n/createTranslator.ts

export type TLocale = 'ko' | 'en' | 'ja' | 'zh';

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
- 번역 키 누락 시 key 자체를 fallback으로 반환 (런타임 오류 없음)
- `en` fallback 고정

### 번역 파일 구조 (`agent-transport`, `agent-cli`)

```typescript
// agent-transport/src/tui/i18n/catalog.ts
import { createTranslator } from '@robota-sdk/agent-framework';

const catalogs = {
  en: {
    navigationHint: '↑↓ Navigate  Enter Select  Esc Back',
    placeholder: 'Type a message or /help',
    confirmYesNo: '[y/n]',
    loading: 'Loading...',
    pressEscBack: 'Press Esc to go back',
    pickerHint: '↑↓ navigate · Enter select · Esc cancel',
    // ...
  },
  ko: {
    navigationHint: '↑↓ 이동  Enter 선택  Esc 뒤로',
    placeholder: '메시지 또는 /help 입력',
    confirmYesNo: '[y/n]',
    loading: '로딩 중...',
    pressEscBack: 'Esc로 뒤로 가기',
    pickerHint: '↑↓ 이동 · Enter 선택 · Esc 취소',
    // ...
  },
  // ja, zh ...
} as const;

export const t = createTranslator(catalogs);
```

```typescript
// agent-cli/src/i18n/catalog.ts
import { createTranslator } from '@robota-sdk/agent-framework';

const catalogs = {
  en: {
    confirmExit: 'Exit the session?',
    confirmClear: 'Clear conversation history?',
    // picker labels ...
  },
  ko: {
    confirmExit: '세션을 종료할까요?',
    confirmClear: '대화 내역을 지울까요?',
    // ...
  },
} as const;

export const t = createTranslator(catalogs);
```

### language 전달 방식

`language`는 이미 `IRenderOptions` → `App` → 각 컴포넌트로 props를 통해 흐른다.
React Context 없이 기존 props 체인 그대로 사용한다.

### 번역 범위 (이번 구현)

- **포함**: TUI 고정 UI 문자열 (네비게이션 힌트, placeholder, confirm 메시지, picker 레이블)
- **제외**: `ICommand.description` — 별도 작업으로 처리 (agent-command 계층에 있으므로)
- **제외**: AI 응답 텍스트

## Scope

- [ ] `agent-framework/src/i18n/createTranslator.ts` 구현 및 export
- [ ] `agent-framework/docs/SPEC.md` i18n engine 섹션 추가
- [ ] `agent-transport/src/tui/i18n/catalog.ts` 작성 (en/ko/ja/zh)
- [ ] agent-transport TUI 컴포넌트 전수 적용 (MenuSelect, InputArea, CommandPicker, CommandConfirm, PluginTUI 등)
- [ ] `agent-cli/src/i18n/catalog.ts` 작성 (en/ko/ja/zh)
- [ ] agent-cli tui-interactions registry 적용
- [ ] `agent-transport/docs/SPEC.md`, `agent-cli/docs/SPEC.md` i18n 섹션 추가

## Test Plan

- [ ] typecheck 전체 통과
- [ ] 번역 키가 TypeScript 타입으로 강제됨 확인 (존재하지 않는 키 사용 시 컴파일 에러)
- [ ] `createTranslator` 단위 테스트: ko/en/ja/zh 각각 반환값 확인, 미지원 언어 fallback 확인
- [ ] TUI 컴포넌트 렌더링 테스트: language=ko 시 한국어 문자열 렌더링 확인
- [ ] `agent-framework` 하위 패키지에 번역 파일 없음 확인 (harness 또는 grep 체크)

## User Execution Test Scenarios

### Scenario 1: language=ko 설정 시 TUI UI 한국어 표시

**Prerequisites**: `~/.robota/settings.json`에 `{ "language": "ko" }` 설정

**Steps**:

```
robota 실행 → TUI 진입
/ 입력 → autocomplete 표시
/mode 선택 (Enter) → picker 오픈
```

**Expected**: placeholder, 네비게이션 힌트, picker 메시지가 한국어로 표시

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
