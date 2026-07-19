---
title: 'CLI-076: headless --model 무효 모델명이 조용히 유효 모델로 대체되어 성공 (No-Fallback 위반)'
status: done
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-transport, packages/agent-transport-tui
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

## Root Cause

`--model` 오버라이드는 CLI가 만든 provider 객체의 `defaultModel`에만 반영되고, 세션 구성 seam
(`buildRuntimeSession`)에는 model이 전달되지 않았다. print/TUI/serve 세 채널 모두 `buildRuntimeSession`이
이미 받는 `model` 필드를 넘기지 않아, 세션이 `options.model ?? config.provider.model ?? 'claude-sonnet-4-5'`
로 조용히 유효 기본 모델로 대체 → 헤더(무효 모델명)와 실제 호출(유효 기본값)이 불일치했다.

## Fix

세 채널이 해석된 model id를 세션에 전달하도록 배선:

- `HeadlessInteractionChannel` (`agent-transport`): `model?` 옵션 추가 + `buildRuntimeSession`에 전달.
- `TuiInteractionChannel` (`agent-transport-tui`) + `render.toChannelOptions`: 표시 `modelId`를 세션 model
  오버라이드로 전달.
- serve `sessionOptions` (`agent-cli/modes/serve-mode`): 해석된 model 전달.
- `agent-cli/cli.ts`: `modelId`(= `resolvedPreset.model ?? providerSettings.model`, 헤더 SSOT)를 print/serve에 전달.

무효 모델은 이제 provider까지 도달해 API 404를 표면화(exit≠0)한다. 클라이언트측 모델 allowlist는
두지 않는다 — 모델 목록은 API가 SSOT이며, allowlist는 새 모델을 오탐 거부할 위험(fragile)이 있다.

## User Execution Test Scenarios

- agent-executable. 위 repro 재실행 → 404가 표면화되고 EXIT≠0 확인. 유효 override / 기본값 회귀도 확인.
- Evidence: `.agents/evals/scenarios/cli-076-invalid-model-error-agent-run.md` (2026-07-19 live Anthropic API):
  - A) `--model claude-nonexistent-model-core020` → `Request failed: 404 ... model: claude-nonexistent-model-core020`, EXIT=1 ✅
  - B) `--model claude-haiku-4-5-20251001` → 헤더==실제, response OK, EXIT=0 ✅
  - C) `--model` 없음 → `claude-sonnet-4-6`, OK, EXIT=0 ✅
- Regression: `headless-channel-options.test.ts` TC-02(CLI-076), `render-channel-options.test.ts` CLI-076.
