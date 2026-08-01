---
title: CLI-BL-029 Markdown Diff Rendering
status: completed
priority: medium
urgency: soon
created: 2026-04-30
branch: feat/cli-markdown-diff-rendering
packages:
  - agent-cli
---

## 요약

Robota CLI에서 에이전트 응답 중 코드 diff를 표시할 때, 별도 인위적 구조를 만들기보다 Markdown fenced code block의 `diff` 문법을 그대로 렌더링하는 방식을 검토한다. 상용 코딩 어시스턴트들은 일반 Markdown 응답 안에 ` ```diff ` 블록을 넣고 diff syntax highlighting으로 표시하는 패턴을 사용하는 것으로 보이며, Robota도 가능한 한 이 단순한 경로를 우선한다.

## 배경

현재 CLI에는 diff 표시를 위한 별도 구조와 렌더링 컴포넌트가 존재한다. 하지만 에이전트 응답 자체가 Markdown이라면, diff 표시도 Markdown renderer가 `diff` fenced code block을 처리하도록 만드는 편이 더 단순하고 유지보수하기 쉽다.

## 목표

- Markdown 응답 안의 ` ```diff ` fenced code block을 terminal에서 읽기 좋은 diff 색상으로 렌더링한다.
- 별도 diff 전용 메시지 구조가 꼭 필요한 경우와 Markdown 렌더링만으로 충분한 경우를 구분한다.
- 기존 `DiffBlock`, `render-markdown`, `marked`, `marked-terminal`, `cli-highlight` 사용 경로를 조사해 가장 작은 변경으로 붙일 수 있는지 확인한다.
- 에이전트가 파일 변경 제안이나 patch preview를 답변할 때 Markdown diff block을 자연스럽게 사용하도록 문서/프롬프트/출력 규칙을 정리한다.

## 리서치 필요 항목

- 상용 코딩 어시스턴트가 응답 내 diff를 Markdown fenced `diff` block으로 표현하는 UX 패턴 확인
- `marked-terminal` 또는 `cli-highlight`가 `diff` language highlighting을 안정적으로 지원하는지 확인
- ANSI color 출력이 CJK/emoji/wide character width 계산과 충돌하지 않는지 확인
- 기존 tool result diff 표시와 assistant response diff 표시를 동일 렌더러로 합칠 수 있는지 확인

## 리서치 결과 (2026-05-02)

- GitHub Docs는 fenced code block에 언어 식별자를 붙여 syntax highlighting을 활성화하는 방식을 표준 Markdown 작성 패턴으로 안내한다. Robota의 assistant 응답도 Markdown이므로 diff 제안은 별도 구조보다 ` ```diff ` fenced block을 우선 렌더링하는 편이 보편적인 작성 방식과 맞다.
  - Source: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks
- `marked-terminal` 7.3.0 README는 `marked` renderer로 terminal Markdown을 출력하고, `cli-highlight`를 통해 syntax highlighting을 지원한다고 설명한다. 현재 의존성 조합을 유지하되 `diff` language만 Robota renderer에서 보강하는 것이 가장 작은 변경이다.
  - Source: https://www.npmjs.com/package/marked-terminal
- `cli-highlight`는 highlight.js language를 terminal ANSI로 변환하는 패키지이며, language를 명시할 수 있다. 다만 `marked-terminal`은 terminal color level이 0이면 code block highlighting을 생략하므로, Robota는 `diff` block에 대해 색상 on/off를 명시적으로 제어 가능한 renderer 경로가 필요하다.
  - Source: https://www.npmjs.com/package/cli-highlight

## 구현 결정

- Assistant 응답의 Markdown diff block은 `render-markdown.ts`가 소유한다.
- `diff` fenced block만 line-level ANSI 색상을 적용하고, 일반 fenced code block은 기존 `marked-terminal` 경로를 유지한다.
- `Edit` tool 결과의 compact diff는 아직 `DiffBlock`이 소유한다. tool summary는 line number, truncation, permission prompt 연동이 필요하므로 이번 변경에서 제거하지 않는다.
- 향후 마이그레이션은 `Edit` tool summary를 Markdown diff 문자열로 저장할 수 있는지 별도 작업에서 검증한다.

## 수용 기준

- [x] Assistant Markdown 응답의 ` ```diff ` block이 terminal에서 추가/삭제 줄을 구분해 렌더링된다.
- [x] 일반 code block, Markdown paragraph, tool summary 출력이 회귀하지 않는다.
- [x] 기존 Edit tool 결과 표시가 Markdown diff rendering으로 대체 가능한지 판단이 문서화된다.
- [x] 대체가 가능하면 별도 구조를 줄이는 마이그레이션 계획이 포함된다.

## 검증

- [x] `render-markdown` 단위 테스트에 `diff` fenced code block Given/When/Then assertion 추가
- [x] 일반 fenced code block과 Markdown inline formatting 회귀 테스트 추가
- [x] `MessageList` assistant response rendering 테스트에서 diff block 포함 응답 substring assertion 추가
- [x] `pnpm --filter @robota-sdk/agent-cli test`
- [x] `pnpm --filter @robota-sdk/agent-cli build`
- [x] `pnpm --filter @robota-sdk/agent-cli lint`
- [x] `pnpm --filter @robota-sdk/agent-cli typecheck`

## 진행 기록

### 2026-05-02

- `renderMarkdown`에 `diff` fenced block 전용 line-level renderer를 추가했다.
- `render-markdown.test.ts`와 `message-list-rendering.test.tsx`에 assistant Markdown diff 회귀 테스트를 추가했다.
- `pnpm harness:scan`과 `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`를 통과했다.

## 결과

- Assistant Markdown 응답의 ` ```diff ` fenced block을 Robota terminal renderer가 추가/삭제/hunk/meta line 단위로 표시한다.
- 일반 code block과 Markdown prose는 기존 `marked-terminal` 경로를 유지한다.
- `Edit` tool compact diff는 line number, truncation, permission prompt 연동 요구 때문에 이번 범위에서는 유지하고, 향후 Markdown diff summary migration 대상으로 남긴다.
