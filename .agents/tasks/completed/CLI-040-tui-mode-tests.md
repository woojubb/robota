---
title: 'CLI-040: TUI 모드 기본 테스트 추가'
status: superseded
created: 2026-05-24
completed: 2026-05-31
priority: high
category: test
---

## 문제

`tui-mode.ts`에 테스트가 전혀 없다. 25개 소스 파일 중 7개만 테스트가 있다(28%).
사용자의 주 사용 경로(대화형 TUI)가 전혀 검증되지 않은 상태로 배포된다.

실제 Ink 렌더링 테스트는 어렵지만, `TuiTransport` 생성 파라미터 매핑은 검증 가능하다.

## 해결 방법

`packages/agent-cli/src/__tests__/tui-mode.test.ts` 신규 작성:

1. `runTuiMode` 옵션이 `TuiTransport` 생성자에 올바르게 전달되는지 검증 (vi.spyOn TuiTransport 생성자)
2. `systemPrompt` / `appendSystemPrompt` 매핑 검증
3. `permissionMode`, `maxTurns`, `language` 전달 검증
4. `buildAppendSystemPrompt` 로직 검증 (taskFile, jsonSchema 조합)
5. `startupUpdateNotice` Promise가 transport에 전달되는지 검증

## 수용 기준

- [ ] TUI 모드 파라미터 매핑 테스트 5개 이상
- [ ] `buildAppendSystemPrompt` 유닛 테스트
- [ ] CI에서 통과

## 관련 파일

- `packages/agent-cli/src/modes/tui-mode.ts`
- `packages/agent-cli/src/startup/append-system-prompt.ts`
- `packages/agent-cli/src/__tests__/`
