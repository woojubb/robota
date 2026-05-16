---
title: 'I18N-001: TUI UI 텍스트 i18n — agent-cli / agent-transport 하드코딩 문자열 로컬라이제이션'
status: backlog
created: 2026-05-17
priority: medium
urgency: later
area: packages/agent-transport, packages/agent-cli
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

### 두 번째 문제: 어느 계층에 i18n이 들어가야 하는가?

현재 의존성 방향:

```
agent-core (zero deps)
  ↑
agent-framework  ← language 설정 소유 (IResolvedConfig.language)
  ↑
agent-transport  ← TUI 문자열 대부분 위치
  ↑
agent-cli        ← registry 문자열, interaction 메시지
```

선택지:

| 옵션 | 위치                                             | 장점                      | 단점                                                   |
| ---- | ------------------------------------------------ | ------------------------- | ------------------------------------------------------ |
| A    | `agent-framework`에 i18n 인프라 추가             | 이미 `language` 설정 소유 | framework 비대화, TUI 의존성 노출                      |
| B    | 새 패키지 `agent-i18n` (core 위, framework 아래) | 관심사 분리, 재사용 가능  | 패키지 추가 비용, 의존성 정리 필요                     |
| C    | `agent-transport` 내부에만                       | 의존성 추가 없음          | agent-cli 문자열 커버 불가 (transport → cli 방향 금지) |
| D    | 각 패키지가 자체 catalog 관리                    | 단순                      | 번역 파일 분산, 일관성 유지 어려움                     |

> ⚠️ 옵션 선택은 **구현 전 사용자 확인 필수**. 이 백로그는 설계 확정 전에는 실행하지 않는다.

## Goal

1. TUI UI 텍스트(네비게이션 힌트, placeholder, 확인 메시지, picker 레이블 등)를 `language` 설정에 따라 번역 제공
2. i18n 인프라가 어느 계층에 속하는지 명확히 결정하고 스펙으로 확정
3. 번역 catalog 추가/수정이 용이한 구조

## Open Questions

1. **계층**: 어느 패키지가 i18n 인프라를 소유하는가? (위 옵션 A~D 중 선택)
2. **라이브러리**: `i18next` 같은 외부 라이브러리 vs. 단순 key→string Record 구조?
3. **전달 방식**: language를 React Context로 TUI 컴포넌트에 전달할지, prop drilling할지?
4. **커버 범위**: UI 텍스트만인가, 아니면 command description(`ICommand.description`)도 포함하는가?
5. **번역 파일 형식**: 코드 내 상수(TypeScript 객체)인가, 외부 JSON/YAML 파일인가?

## Scope (확정 후 채울 것)

- [ ] 계층/패키지 결정
- [ ] 번역 대상 문자열 전수 목록 작성
- [ ] 초기 지원 언어: ko, en, ja, zh
- [ ] agent-transport TUI 컴포넌트 번역 적용
- [ ] agent-cli tui-interactions registry 번역 적용
- [ ] SPEC.md 업데이트 (소유 패키지)

## Test Plan

- [ ] typecheck 전체 통과
- [ ] 지원 언어별 번역 키 누락 시 빌드 또는 테스트 실패 (타입 또는 harness 게이트)
- [ ] language=ko 설정 시 한국어 UI 문자열 렌더링 단위 테스트
- [ ] language=en 설정 시 영어 UI 문자열 렌더링 단위 테스트

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

**Evidence**: _(단위 테스트 또는 수동 확인)_
