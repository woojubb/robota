---
title: 'CLI-076: headless --model 무효 모델명이 조용히 유효 모델로 대체되어 성공 (No-Fallback 위반)'
status: todo
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-provider
depends_on: []
---

# headless --model 무효 모델명이 조용히 유효 모델로 대체되어 성공

CORE-020 라이브 UE 중 발견 (2026-07-04). 존재하지 않는 모델명을 --model로 넘겨도 headless
실행이 정상 응답 + exit 0으로 성공한다. Anthropic API는 동일 모델명에 404 not_found를
반환하므로, CLI→provider 경로 어딘가에서 무효 모델이 유효 모델로 조용히 대체되고 있다 —
No-Fallback 위반이며, 헤더 표시(`Using anthropic (claude-nonexistent-...)`)와 실제 호출
모델이 다른 오표시이기도 하다.

## Repro (2026-07-04 실측)

```bash
# CLI: 성공해버림 (잘못됨)
node packages/agent-cli/bin/robota.cjs -p "What is 7+8? Reply with the number only" \
  --model claude-nonexistent-model-core020
# → 헤더는 nonexistent 모델명 표시, 응답 "15", EXIT=0

# 같은 키로 API 직접 호출: 404
# → {"type":"error","error":{"type":"not_found_error","message":"model: claude-nonexistent-model-core020"}}
```

## What

1. --model → chatOptions.model 전 구간 추적, 대체 지점 특정 (후보: CLI 인자 배선
   `cli.ts` modelId 흐름, framework 조립, provider defaultModel 병합).
2. 무효/미배선 모델명은 조용한 대체 대신 에러로 표면화 (CORE-020 실패 계약과 정합).
3. 헤더 표시 모델 == 실제 호출 모델 보장.

## Test Plan

- --model 오버라이드가 provider chat 호출까지 도달하는 회귀 테스트.
- 무효 모델명 headless 실행 → 비정상 종료코드 실측.

## User Execution Test Scenarios

- agent-executable. 위 repro 재실행 → 404가 표면화되고 EXIT≠0 확인.
- Evidence: (record after execution)
