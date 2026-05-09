---
title: 'HOOK-002: UserPromptSubmit stdin user_prompt 필드 갭 없음 — 종결'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: hooks
depends_on: HOOK-001
---

## Problem (Initial)

CC가 `user_prompt` 필드를 사용한다고 가정하고 SDK에 해당 필드가 없다고 기술했다.

## Verification Result

공식 Claude Code 문서 재확인 결과 CC의 UserPromptSubmit stdin 필드명은 **`prompt`** 다.
SDK는 `session-run.ts`에서 이미 `prompt: rawInput ?? message`를 전달하고 있다.

**갭 없음 — 이 항목은 잘못된 리서치를 기반으로 작성되었으며 실제 수정 필요 없음.**

## Note

초기 리서치에서 `user_prompt`를 CC 필드명으로 잘못 인용했다.
공식 문서 재검증으로 오류 확인 후 이 백로그를 종결 처리함.
