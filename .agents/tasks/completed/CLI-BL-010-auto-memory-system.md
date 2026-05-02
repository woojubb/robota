---
title: Auto Memory — cross-session 학습 시스템
status: completed
priority: critical
urgency: now
created: 2026-03-26
packages:
  - agent-sdk
  - agent-cli
---

## 요약

세션 간 학습이 불가능. 매 세션마다 같은 컨텍스트를 처음부터 다시 제공해야 함. 파일 기반 persistent memory 시스템이 필요.

## Prior Art Research

- Claude Code memory docs: session startup loads static `CLAUDE.md` instructions and auto memory; auto memory is scoped per working tree, stored as plain markdown, loaded into every session with a first-200-lines or 25KB cap, and browsed/edited with `/memory`. Source: <https://code.claude.com/docs/en/memory>
- Cursor Memories docs: memories are project-scoped, extracted by a sidecar process, and background-generated memories require approval before saving. Source: <https://docs.cursor.com/en/context/memories>
- OpenAI Codex AGENTS.md docs: persistent project context is markdown-based, loaded at session start, ordered from broad scope to narrow scope, and size-capped. Source: <https://developers.openai.com/codex/guides/agents-md>

## Design Decision

- Native Robota memory lives under `.robota/memory/`.
- `.robota/memory/MEMORY.md` is the session-start index. It is capped to the first 200 lines and 25KB before prompt injection.
- Topic details live under `.robota/memory/topics/<topic>.md` and are read on demand.
- Memory belongs in `agent-sdk` because SDK owns context loading, system prompt composition, and command execution. `agent-cli` remains a TUI-only consumer.
- `/memory` is a built-in SDK command with model-visible descriptor metadata. It provides `list`, `show`, and `add` operations. Passive sidecar extraction is deferred until an approval UX exists.

## 필요 기능

1. 프로젝트별 메모리 디렉토리 (`.claude/memory/` 또는 `.robota/memory/`)
2. MEMORY.md 인덱스 파일 + 토픽별 상세 파일
3. 메모리 타입: user, feedback, project, reference
4. 자동 저장 — 에이전트가 유용한 정보를 자동 기록
5. 세션 시작 시 관련 메모리 자동 로드
6. `/memory` 명령어 — 메모리 조회/편집
7. 200줄 제한 (MEMORY.md 인덱스)

## 참고

- Claude Code: auto memory, MEMORY.md, topic files
- 현재 CLAUDE.md/AGENTS.md 정적 설정은 있으나 동적 학습 없음

## 검증

- [x] RED: memory store/context/command tests fail before implementation
- [x] GREEN: `pnpm --filter @robota-sdk/agent-sdk test -- memory`
- [x] GREEN: `pnpm --filter @robota-sdk/agent-sdk test -- system-command`
- [x] GREEN: `pnpm --filter @robota-sdk/agent-sdk typecheck`
- [x] GREEN: `pnpm --filter @robota-sdk/agent-sdk build`
- [x] GREEN: `pnpm --filter @robota-sdk/agent-sdk lint`
- [x] GREEN: `pnpm --filter @robota-sdk/agent-sdk test`
- [x] GREEN: `pnpm harness:scan`

## Result

- Added `.robota/memory/MEMORY.md` startup loading with a first-200-lines and 25KB cap.
- Added SDK-owned project memory store and `/memory list|show|add` built-in command.
- Exposed `/memory` as a model-invocable built-in command through command descriptor metadata.
- Kept CLI as a thin consumer: no provider/TUI-specific memory branching was added.
