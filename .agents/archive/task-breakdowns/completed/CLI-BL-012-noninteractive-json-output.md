---
title: Non-interactive 모드 개선 — JSON 출력 + Pipe + System Prompt
status: backlog
priority: high
urgency: soon
created: 2026-03-26
packages:
  - agent-cli
---

## 요약

`-p` 프린트 모드의 구조화된 출력과 CI/CD 통합 기능.

## 구현 항목

- `--output-format json` — JSON 출력 (response, session_id, toolSummaries, contextState)
- `--output-format stream-json` — 실시간 스트리밍 JSON (newline-delimited)
- stdin pipe 지원 — `echo "prompt" | robota -p`
- exit code — 성공 0, 실패 1
- `--system-prompt` / `--append-system-prompt` — 시스템 프롬프트 주입

## 참고

- Claude Code: `--output-format json`, `--output-format stream-json`, `--system-prompt`, `--append-system-prompt`, stdin pipe
