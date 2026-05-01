---
title: CLI-BL-028 Ink 7 CJK and TUI Follow-ups
status: backlog
priority: medium
urgency: soon
created: 2026-04-30
packages:
  - agent-cli
---

## 요약

Ink 7 업데이트 리서치에서 확인한 CJK/wide character 개선과 신규 TUI API를 Robota CLI에 단계적으로 반영한다. 현재 Ink 7 업데이트는 의존성/호환성 반영에 집중하고, paste/resize/layout/animation API 도입은 별도 테스트 보호 아래 후속 작업으로 진행한다.

## 리서치 결과

- Ink 7.0.0은 Node.js 22와 React 19.2+를 요구한다.
- Ink 7.0.0은 Backspace 입력을 `key.delete`가 아니라 `key.backspace`로 정확히 보고한다.
- Ink 7.0.0은 plain Escape에서 `key.meta=true`를 더 이상 설정하지 않고 `key.escape=true`만 설정한다.
- Ink 7.0.0은 `usePaste`, `useWindowSize`, `useBoxMetrics`, `useAnimation`, `render({ alternateScreen })`, `render({ interactive })`를 추가했다.
- Ink 7.0.0 릴리즈 노트에 CJK가 명시되어 있다. `<Box>` width를 초과하는 CJK text truncation 문제와 overlapping writes에서 emoji/CJK wide character가 쪼개지는 문제가 수정되었다.
- Ink 7.0.1은 `useApp().exit` typing과 disabled focus 상태에서 Escape 처리 문제를 수정했다.

## 참고 링크

- Ink v6.8.0 release: https://github.com/vadimdemedes/ink/releases/tag/v6.8.0
- Ink v7.0.0 release: https://github.com/vadimdemedes/ink/releases/tag/v7.0.0
- Ink v7.0.1 release: https://github.com/vadimdemedes/ink/releases/tag/v7.0.1

## 반영 계획

1. `usePaste` 검토: 현재 `CjkTextInput`의 bracketed paste/manual paste handling을 바로 대체하지 않고, 기존 paste label, multi-line paste, Korean/CJK cursor behavior characterization test를 먼저 만든 뒤 적용한다.
2. `useWindowSize` 검토: `InputArea`의 `useStdout().stdout.columns` 기반 width 계산을 terminal resize reactive API로 대체할 수 있는지 확인한다.
3. CJK 렌더링 회귀 검증: MessageList, StreamingIndicator, DiffBlock, markdown rendering에서 긴 CJK 문장, emoji 포함 문자열, overlapping streaming write 상황을 테스트한다.
4. `alternateScreen` 검토: 기본값으로 도입하지 않고 opt-in TUI mode 후보로 UX를 검토한다. scrollback 보존 기대와 충돌할 수 있다.
5. `useAnimation` 검토: `WaveText`나 streaming indicator 애니메이션 정리에 쓸 수 있는지 확인하되, `TuiStateManager`의 streaming debounce는 유지한다.

## 수용 기준

- Korean/CJK 입력과 paste 관련 기존 동작이 유지된다.
- CJK/wide character truncation 또는 split 문제가 실제로 개선되는지 테스트로 확인된다.
- terminal resize가 필요한 UI는 resize 이벤트에 따라 안정적으로 다시 렌더링된다.
- 신규 Ink API 도입 시 App-level ESC abort, permission prompt, plugin TUI, session picker 입력 우선순위가 깨지지 않는다.

## 검증

- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm --filter @robota-sdk/agent-cli lint`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- PTY 기반 provider setup and paste tests 통과 확인
- Korean/CJK manual smoke test: iTerm2와 macOS Terminal.app에서 입력, paste, cursor movement, abort 동작 확인
