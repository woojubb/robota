---
title: Prompt History Navigation — 방향키로 이전 프롬프트 재사용
status: completed
priority: medium
urgency: now
created: 2026-03-26
packages:
  - agent-cli
---

## 요약

입력 창에서 방향키 위/아래로 이전 프롬프트 히스토리를 탐색하여 재사용. 터미널 쉘의 명령어 히스토리(↑/↓)와 동일한 UX.

## 참고

- Claude Code: input 창에서 ↑ 키로 이전 프롬프트 순회 가능
- 터미널 쉘(bash/zsh)의 명령어 히스토리와 동일한 패턴

## 리서치

- Claude Code 공식 Interactive mode 문서는 `Up/Down arrows`를 command history navigation으로 설명하며 이전 입력을 recall하는 shortcut으로 둔다.
- Claude Code 공식 Keybindings 문서는 `history:previous` 기본값을 `Up`, `history:next` 기본값을 `Down`으로 정의한다.
- 쉘 히스토리 UX는 `Up`으로 가장 최근 입력부터 과거 방향으로 이동하고, `Down`으로 최신 방향으로 돌아오며 마지막 이후에는 입력 중이던 draft를 복원한다.

## 설계 결정

- Prompt history 의미는 `InputArea` 컴포넌트에 하드코딩하지 않고 `input-area-flow` 순수 함수로 둔다.
- `InputArea`는 history navigation 결과의 value/cursorHint/state만 반영한다.
- `CjkTextInput`의 기존 vertical cursor navigation과 충돌하지 않도록 InputArea 사용 시 위/아래 화살표의 의미를 prompt history로 위임한다.
- 현재 세션에서 submit한 prompt를 즉시 local history에 추가하고, 복원된 session history의 user chat entry도 초기 history 후보로 사용한다.

## 테스트 계획

- Given prompt history가 비어 있으면 When Up/Down을 누를 때 Then 입력값은 유지된다.
- Given 현재 draft가 있고 history가 있으면 When Up을 누를 때 Then 최신 prompt가 표시되고 draft가 저장된다.
- Given history 탐색 중이면 When Down으로 마지막 이후로 이동할 때 Then 저장된 draft가 복원된다.
- Given prompt를 제출하면 When history에 추가할 때 Then 빈 입력은 제외되고 연속 중복은 추가되지 않는다.
- Given session history entries가 있으면 When prompt history를 추출할 때 Then user chat content만 포함된다.

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인

## 완료

- `input-area-flow`에 prompt history navigation 상태 전이 추가
- `InputArea`가 현재 세션 submit prompt와 복원된 user chat history를 기반으로 Up/Down prompt history를 제공
- `CjkTextInput`에 `enableVerticalNavigation` 옵션을 추가해 parent flow가 위/아래 화살표 의미를 소유할 수 있게 분리
- SPEC에 prompt history와 CjkTextInput vertical navigation의 소유권을 반영

## 검증 결과

- `pnpm --filter @robota-sdk/agent-cli test` 통과
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- `pnpm --filter @robota-sdk/agent-cli build` 통과
- `pnpm --filter @robota-sdk/agent-cli lint` 통과 (기존 warning 유지)
- `pnpm harness:scan` 통과
- `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check` 통과
