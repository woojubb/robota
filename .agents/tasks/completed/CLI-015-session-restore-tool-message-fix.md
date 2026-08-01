---
title: 'CLI-015: 세션 복원 시 non-string content tool 메시지 묵시적 스킵 수정'
status: done
created: 2026-05-23
priority: critical
urgency: now
area: packages/agent-framework
depends_on: []
---

## Background

`packages/agent-framework/src/interactive/interactive-session-restore.ts:24`의 `injectSavedMessage`가 `typeof msg.content !== 'string'`이면 해당 메시지를 조용히 무시한다.

`tool_use` 메시지 이후에는 반드시 `tool_result` 메시지가 따라와야 한다 (Anthropic API 스펙). `tool_result` 메시지는 `parts` 배열 형태의 content를 가질 수 있는데, 이 경우 세션 복원 시 해당 메시지가 skip되어 `tool_use` + `tool_result` 쌍이 불완전해진다. 복원 후 다음 AI 호출에서 Anthropic API가 400 에러를 반환한다.

## 작업 항목

- `interactive-session-restore.ts` `injectSavedMessage` 수정
  - `content`가 string이 아닌 경우 `JSON.stringify(msg.content)` 로 변환하여 삽입 (단기 수정)
  - 또는 `TUniversalMessage`의 parts 배열을 그대로 전달하도록 세션 복원 로직 개선 (완전 수정)
- content가 string이 아닌 메시지 skip 시 최소한 `console.warn` 또는 이벤트 emit으로 디버깅 가능하게 만들기
- `tool_use` 이후 `tool_result`가 없는 히스토리 상태를 복원 시점에 감지하는 validation 추가 검토

## Test Plan

- parts 배열 content를 가진 tool_result 메시지가 포함된 세션 파일로 `--resume` 후 정상 동작 확인
- 복원 후 AI 호출 시 400 에러 없음 확인
- tool_use + tool_result 쌍이 복원된 히스토리에 완전히 포함되는지 확인

## User Execution Test Scenarios

### Scenario 1: 툴 호출 포함 세션 복원

```bash
# 툴 호출을 포함하는 세션 생성
robota "현재 디렉토리 파일 목록을 보여줘"

# 세션 재개
robota --continue
```

Expected: 이전 세션 히스토리 완전 복원, API 400 에러 없이 대화 재개 가능
