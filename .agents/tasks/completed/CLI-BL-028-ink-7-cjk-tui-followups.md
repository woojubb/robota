---
title: CLI-BL-028 Ink 7 CJK and TUI Follow-ups
status: completed
priority: medium
urgency: soon
created: 2026-04-30
packages:
  - agent-cli
branch: feat/ink-7-cjk-tui-followups
---

## 요약

Ink 7 업데이트 리서치에서 확인한 CJK/wide character 개선과 신규 TUI API를 Robota CLI에 단계적으로 반영한다. 현재 Ink 7 업데이트는 의존성/호환성 반영에 집중하고, paste/resize/layout/animation API 도입은 별도 테스트 보호 아래 후속 작업으로 진행한다.

## 리서치 결과

- 2026-05-02 재확인 결과 Ink 최신 릴리스는 v7.0.1이다.
- Ink 7.0.0은 Node.js 22와 React 19.2+를 요구한다.
- Ink 7.0.0은 Backspace 입력을 `key.delete`가 아니라 `key.backspace`로 정확히 보고한다.
- Ink 7.0.0은 plain Escape에서 `key.meta=true`를 더 이상 설정하지 않고 `key.escape=true`만 설정한다.
- Ink 7.0.0은 `usePaste`, `useWindowSize`, `useBoxMetrics`, `useAnimation`, `render({ alternateScreen })`, `render({ interactive })`를 추가했다.
- Ink 7.0.0 릴리즈 노트에 CJK가 명시되어 있다. `<Box>` width를 초과하는 CJK text truncation 문제와 overlapping writes에서 emoji/CJK wide character가 쪼개지는 문제가 수정되었다.
- Ink 7.0.1은 `useApp().exit` typing과 disabled focus 상태에서 Escape 처리 문제를 수정했다.
- Ink 7 `usePaste`는 bracketed paste mode를 hook 활성 기간에 자동으로 켜고 끄며, paste content를 `useInput`과 분리된 이벤트 채널로 전달한다.
- Ink 7 `useWindowSize`는 `{ columns, rows }`를 반환하고 terminal resize 때 컴포넌트를 다시 렌더링한다.

## 참고 링크

- Ink v6.8.0 release: https://github.com/vadimdemedes/ink/releases/tag/v6.8.0
- Ink v7.0.0 release: https://github.com/vadimdemedes/ink/releases/tag/v7.0.0
- Ink v7.0.1 release: https://github.com/vadimdemedes/ink/releases/tag/v7.0.1

## 반영 계획

1. `usePaste` 적용: `CjkTextInput`은 Ink hook 이벤트만 받아 flow에 전달하고, paste classification/normalization은 `cjk-text-input-flow`가 소유한다.
2. `useWindowSize` 적용: `InputArea`의 `useStdout().stdout.columns` 기반 width 계산을 terminal resize reactive API로 대체한다.
3. CJK paste 회귀 검증: single-line CJK paste, multiline paste label, CRLF normalization, 기존 bracketed-paste fallback을 unit test로 고정한다.
4. `alternateScreen`은 기본값으로 도입하지 않는다. scrollback 보존 기대와 충돌할 수 있어 별도 UX 결정이 필요하다.
5. `useAnimation`은 이번 범위에서 제외한다. `WaveText`/streaming indicator 변경은 별도 visual regression 보호가 필요하다.

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

## 진행

### 2026-05-02

- `feat/ink-7-cjk-tui-followups` 브랜치에서 작업 시작.
- Ink v6.8.0, v7.0.0, v7.0.1 release notes와 Ink 7 README hook 문서를 재확인.
- `CjkTextInput`에 `usePaste`를 연결하고 paste 처리 의미는 `cjk-text-input-flow` 순수 함수로 분리.
- `InputArea` width 계산을 `useWindowSize` 기반으로 전환.
- CJK paste와 streaming/message rendering 회귀 테스트를 추가.
- 전체 `agent-cli` test/build/typecheck/lint와 `harness:scan`으로 검증.
- 전체 `agent-cli` 테스트 중 발견된 `/rewind` slash command routing 회귀를 SDK system command로 통과시키도록 수정.

## 결과

- Ink 7 `usePaste`를 `CjkTextInput`에 적용하고, paste classification/line-ending normalization은 `cjk-text-input-flow` 순수 함수에서 처리하도록 분리했다.
- `InputArea` terminal width 계산을 Ink 7 `useWindowSize` 기반으로 바꿔 resize 반응성을 Ink API에 위임했다.
- 전역 bracketed paste 토글은 제거하고, Ink hook lifecycle이 paste mode를 소유하도록 정리했다.
- CJK paste, multiline paste, CRLF normalization, CJK/emoji rendering 회귀 테스트를 추가했다.
- `alternateScreen`과 `useAnimation`은 이번 범위에서 도입하지 않았다. scrollback/visual regression 정책이 필요한 별도 UX 결정 사항이다.
