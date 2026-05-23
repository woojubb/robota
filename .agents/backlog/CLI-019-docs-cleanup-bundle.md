---
title: 'CLI-019: CLI 문서 정리 bundle (env vars + 숨긴 플래그 + /settings 문서화)'
status: done
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli, apps/docs
depends_on: []
---

## Background

CLI 레퍼런스 문서와 실제 구현 사이에 세 가지 불일치가 발견되었다.

1. **환경 변수 표 누락**: `packages/agent-cli/README.md`의 환경 변수 표에 `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY` 세 개만 있고 `OPENAI_API_KEY`, `GEMINI_API_KEY` 등이 빠져있다.

2. **숨겨진 플래그**: `cli-args.ts`에 `--task-file`, `--bare`, `--format`, `--summary`, `--source`, `--fork-session` 플래그가 정의되어 있으나 `--help` 출력과 CLI 레퍼런스 문서 어디에도 없다. 내부 전용인지 미완성인지 불명확하다.

3. **`/settings` 커맨드 문서 누락**: `default-command-modules.ts`에 `createSettingsCommandModule()`이 포함되어 있으나 `content/guide/cli.md`의 슬래시 커맨드 표에 없다.

## 작업 항목

- `packages/agent-cli/README.md` 환경 변수 표 업데이트
  - 지원하는 모든 프로바이더의 환경 변수 추가 (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `QWEN_API_KEY` 등)
- `cli-args.ts` 숨겨진 플래그 처리
  - 내부 전용 플래그에 `hidden: true` 또는 파서에서 제거
  - 공개 플래그라면 `--help` 출력 및 문서에 추가
- `content/guide/cli.md` 슬래시 커맨드 표에 `/settings` 추가
  - `/settings` 커맨드가 실제로 어떤 기능을 제공하는지 구현 파일 확인 후 문서화

## Test Plan

- `robota --help` 출력에 모든 공개 플래그 포함 확인
- `content/guide/cli.md` 슬래시 커맨드 수가 `default-command-modules.ts` 등록 수와 일치 확인
- 모든 지원 프로바이더의 환경 변수가 README에 포함 확인

## User Execution Test Scenarios

Not applicable — documentation changes.
