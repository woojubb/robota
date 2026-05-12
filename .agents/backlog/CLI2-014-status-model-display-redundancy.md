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

## Options to Consider

- **model name만 표시**: `Claude Sonnet 4.6 (anthropic)` — 사람이 읽기 편함
- **model ID만 표시**: `claude-sonnet-4-6-2 (anthropic)` — 정확한 버전 구분 가능
- **짧은 alias**: provider별 약어 (e.g. `Sonnet 4.6`) — 공간 절약
- **조건부**: 좁은 터미널은 name, 넓은 터미널은 name + id

## Acceptance Criteria

- Status bar에 모델 정보가 중복 없이 표기된다.
- 표기 방식이 결정되면 모든 transport(TUI, headless)에 일관 적용된다.

## Notes

현재 표기 예시: `claude-sonnet-4-6-2 (anthropic) Claude Sonnet 4.6`
