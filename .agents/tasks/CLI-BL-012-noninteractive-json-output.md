---
title: Non-interactive 모드 개선 — JSON 출력 + Pipe + System Prompt
status: backlog
priority: high
created: 2026-03-26
urgency: soon
packages:
  - agent-cli
---

## 요약

`-p` 프린트 모드는 있으나 구조화된 출력과 CI/CD 통합 기능이 부족.

## 기술 검토 (2026-03-26)

### Claude Code 사양

| 플래그                        | 동작                                            |
| ----------------------------- | ----------------------------------------------- |
| `-p` / `--print`              | non-interactive 모드, 텍스트 출력 (기본)        |
| `--output-format json`        | JSON 출력 (result, session_id, usage, messages) |
| `--output-format stream-json` | 실시간 스트리밍 JSON (newline-delimited)        |
| `--json-schema '{...}'`       | 구조화 출력 (스키마 검증)                       |
| `--system-prompt`             | 시스템 프롬프트 교체                            |
| `--append-system-prompt`      | 시스템 프롬프트 추가                            |
| `--system-prompt-file`        | 파일에서 시스템 프롬프트 읽기                   |
| `--bare`                      | 자동 탐색 스킵 (스킬, 플러그인, MCP, CLAUDE.md) |
| `--allowedTools`              | 도구 사전 승인                                  |
| `--max-budget-usd`            | 비용 제한                                       |
| `--no-session-persistence`    | 세션 저장 안 함 (print mode 전용)               |
| stdin pipe                    | `cat file \| claude -p "query"`                 |

### 구현 우선순위

**즉시 (P0):**

- `--output-format json` — JSON 출력 (response, session_id, toolSummaries, contextState)
- stdin pipe 지원 — `echo "prompt" | robota -p`
- exit code — 성공 0, 실패 1

**이후 (P1):**

- `--output-format stream-json` — 실시간 스트리밍 JSON
- `--system-prompt` / `--append-system-prompt` — 시스템 프롬프트 주입

**나중 (P2):**

- `--bare` — 자동 탐색 스킵 (빠른 스크립트 실행)
- `--allowedTools` — 도구 사전 승인
- `--no-session-persistence` — 세션 저장 안 함
- `--json-schema` — 구조화 출력
