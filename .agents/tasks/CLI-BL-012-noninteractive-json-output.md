---
title: Non-interactive 모드 개선 — JSON 출력 + Pipe 지원
status: backlog
priority: high
created: 2026-03-26
packages:
  - agent-cli
---

## 요약

`-p` 프린트 모드는 있으나 구조화된 출력이 없음. CI/CD와 스크립트 통합에 필요.

## 필요 기능

1. `-j` / `--json` — JSON 형식 출력 (response, tool calls, context state)
2. stdin pipe 지원 — `echo "prompt" | robota`
3. stdout 스트리밍 — 실시간 텍스트 출력 (non-interactive에서도)
4. exit code — 성공/실패에 따른 종료 코드
5. `--system-prompt` — 커맨드라인에서 시스템 프롬프트 주입

## 참고

- Claude Code: `-p` print mode, `-j` JSON, pipe support, structured output
