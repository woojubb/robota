---
title: CLI-BL-029 Markdown Diff Rendering
status: backlog
priority: medium
urgency: soon
created: 2026-04-30
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

## 수용 기준

- Assistant Markdown 응답의 ` ```diff ` block이 terminal에서 추가/삭제 줄을 구분해 렌더링된다.
- 일반 code block, Markdown paragraph, tool summary 출력이 회귀하지 않는다.
- 기존 Edit tool 결과 표시가 Markdown diff rendering으로 대체 가능한지 판단이 문서화된다.
- 대체가 가능하면 별도 구조를 줄이는 마이그레이션 계획이 포함된다.

## 검증

- `render-markdown` 단위 테스트에 `diff` fenced code block Given/When/Then assertion 추가
- 일반 fenced code block과 Markdown inline formatting 회귀 테스트 추가
- `MessageList` 또는 assistant response rendering 테스트에서 diff block 포함 응답 snapshot/substring assertion 추가
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm --filter @robota-sdk/agent-cli lint`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
