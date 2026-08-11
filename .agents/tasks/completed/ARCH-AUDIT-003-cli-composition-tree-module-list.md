---
title: 'ARCH-AUDIT-003: CLI composition-tree.md 기본 모듈 목록 코드와 동기화'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: documentation
---

## Problem

`.agents/specs/architecture-map/agent-cli/composition-tree.md`의 default composition 모듈 목록이 실제 `packages/agent-cli/src/` 코드와 불일치한다.

| 상태                    | 모듈                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| 문서에만 있고 코드 없음 | `createModeCommandModule()` (optional legacy — default에 미포함) |
| 코드에만 있고 문서 없음 | `createSkillsCommandModule({ cwd })`                             |
| 코드에만 있고 문서 없음 | `createUserLocalCommandModule()`                                 |

## Solution

실제 CLI 진입점 코드를 source-verified 후 목록을 갱신한다. `agent-command-mode`는 optional legacy로 별도 표기한다.

## Test Plan

- `packages/agent-cli/src/` 진입점 코드와 문서 목록 대조
- source-verified 날짜를 2026-05-09로 갱신

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.
