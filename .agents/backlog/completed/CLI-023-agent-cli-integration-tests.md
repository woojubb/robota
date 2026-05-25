---
title: 'CLI-023: agent-cli tui-mode / print-mode 통합 테스트 추가'
status: done
created: 2026-05-23
priority: medium
urgency: later
area: packages/agent-cli
depends_on: []
---

## Background

`packages/agent-cli`는 5개의 테스트 파일이 있으나 모두 unit 테스트다. `runTuiMode`, `runPrintMode` 등 실제 실행 경로에 대한 통합 테스트가 전혀 없다.

`bin.ts` → `cli.ts` → `runTuiMode/runPrintMode` 전체 경로를 커버하는 smoke test가 없으면 주요 실행 흐름의 회귀를 감지하기 어렵다.

## 작업 항목

- headless transport(실제 AI 호출 없는 mock provider)를 사용하는 통합 테스트 추가
- 커버해야 할 시나리오:
  1. `robota -p "hello" --output-format text` — print 모드 기본 실행
  2. `robota -p "hello" --output-format json` — JSON 출력 형식
  3. `robota -p "hello" --output-format stream-json` — 스트림 JSON 출력
  4. `robota --dry-run "test"` — dry-run 모드
  5. stdin 파이프 입력 처리 (`echo "hello" | robota -p "process this"`)
  6. `--max-turns 1` 한도 초과 시 정상 종료
  7. `--permission-mode bypassPermissions` 플래그 처리
- TUI 모드는 pseudo-TTY 없이 테스트하기 어려우므로 print 모드 중심으로 먼저 작성

## Test Plan

- mock provider로 실제 API 호출 없이 통합 테스트 실행
- 모든 시나리오 `pnpm test` 통과 확인
- 기존 5개 테스트 회귀 없음 확인

## User Execution Test Scenarios

Not applicable — automated test additions only.
