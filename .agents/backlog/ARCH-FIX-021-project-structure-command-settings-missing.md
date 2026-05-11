---
title: 'ARCH-FIX-021: project-structure.md 커맨드 모듈 목록에 agent-command-settings 누락'
status: todo
created: 2026-05-11
priority: low
urgency: normal
area: architecture
---

## Problem

`packages/agent-command-settings/`가 실제로 존재하고 SPEC.md도 있지만
`.agents/project-structure.md`의 `agent-command-*` 설명 주석 목록에 `settings`가 빠져 있다.

현재:

```
# Command modules: agent, background, compact, context, exit, help, language, memory,
#                  mode, model, permissions, plugin, provider, reset, rewind,
#                  session, skills, statusline, user-local
```

`settings`가 없어서 아키텍처 맵과 실제 코드가 불일치한다.

## Required Change

`project-structure.md`의 `agent-command-*` 설명 주석에 `settings` 추가:

```
# Command modules: agent, background, compact, context, exit, help, language, memory,
#                  mode, model, permissions, plugin, provider, reset, rewind,
#                  session, settings, skills, statusline, user-local
```

## Scope

- `.agents/project-structure.md` — 커맨드 모듈 목록 주석 수정 (1줄)

## Test Plan

1. `pnpm harness:scan` 통과 (일관성 체크)

## User Execution Test Scenarios

### 시나리오: harness scan

**agent-executability**: `agent-executable`

**실행 단계**:

```bash
pnpm harness:scan
```

**기대 결과**: scan PASS, project-structure.md 기재 내용과 실제 패키지 일치

**증거 필드** (구현 후 기입):

- 관찰 결과: \_
- 종료 코드: \_
