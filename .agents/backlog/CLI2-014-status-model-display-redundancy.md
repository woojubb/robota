---
title: 'CLI2-014: status bar model display — model ID와 model name 병행 표기 정리'
status: todo
created: 2026-05-12
priority: low
urgency: later
area: packages/agent-transport-tui, packages/agent-cli
---

## Problem

Status bar에 `claude-sonnet-4-6-2 (anthropic) Claude Sonnet 4.6` 처럼 model ID와 human-readable model name이 동시에 표기된다. 중복이고 공간 낭비이며 어떤 정보를 우선해야 할지 결정이 필요하다.

## Decision

**model ID만 표시** (`claude-sonnet-4-6-2 (anthropic)`)

이유:

- model name은 사전에 알 수 없는 경우 변환 불가
- 모델명은 세분화가 심해 human-readable name으로 정확히 대응하기 어려움
- model ID가 더 정확하고 신뢰할 수 있는 표기

## Acceptance Criteria

- Status bar에 model ID + provider만 표기된다 (e.g. `claude-sonnet-4-6-2 (anthropic)`)
- human-readable model name은 status bar에서 제거된다.
- 모든 transport(TUI, headless)에 일관 적용된다.

## Notes

현재 표기 예시: `claude-sonnet-4-6-2 (anthropic) Claude Sonnet 4.6`
목표 표기 예시: `claude-sonnet-4-6-2 (anthropic)`
