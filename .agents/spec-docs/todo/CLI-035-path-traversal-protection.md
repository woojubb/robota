---
status: approved
type: SECURITY
tags: [cli, security, tools]
---

# CLI-035: Read/Write/Edit 도구 경로 순회(Path Traversal) 보호

## Problem

`packages/agent-tools/src/builtins/read-tool.ts`, `write-tool.ts`, `edit-tool.ts`가 파일 경로를 검증하지 않는다. LLM이 `/etc/passwd`, `~/.ssh/id_rsa`, `../../../.env` 같은 경로를 요청하면 제어 없이 접근 가능하다. 특히 print 모드 기본값이 `bypassPermissions`(`print-mode.ts` L52)이므로 권한 시스템도 우회된다.

재현 조건: `robota -p "read /etc/passwd"` 실행 시 파일 내용이 출력된다.

## Architecture Review

### Affected Scope

- `packages/agent-tools/src/builtins/read-tool.ts` — 경로 검증 가드 추가
- `packages/agent-tools/src/builtins/write-tool.ts` — 경로 검증 가드 추가
- `packages/agent-tools/src/builtins/edit-tool.ts` — 경로 검증 가드 추가

### Alternatives Considered

- **Alt A (채택): cwd 밖 경로 접근 시 에러 반환** — Pro: 실수 및 LLM 오용 모두 차단, `workspace-manifest.ts`의 기존 패턴 재사용 가능. Con: 의도적으로 cwd 밖 파일 접근이 필요한 사용 사례를 막음.
- **Alt B: 보안 문서에만 "임의 절대 경로 처리 가능"을 명시** — Pro: 유연성 유지. Con: 실질적 보호 없음, LLM이 민감한 경로를 요청하면 그대로 노출.

### Decision

Alt A 채택. `workspace-manifest.ts`의 `validateWorkspaceManifestPath()` 패턴을 참조해 cwd 범위 밖 경로를 차단하는 `assertWithinCwd()` 헬퍼를 구현. `bypassPermissions` 모드에서도 경로 검증은 항상 적용.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — workspace-manifest.ts 참조 구현 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`assertWithinCwd(filePath, cwd)` 헬퍼를 `agent-tools` 패키지에 추가. read/write/edit-tool.ts 각각의 실행 경로에서 파일 경로 검증 적용. cwd 외부 접근 시 명확한 에러 메시지 반환.

## Affected Files

- `packages/agent-tools/src/builtins/read-tool.ts`
- `packages/agent-tools/src/builtins/write-tool.ts`
- `packages/agent-tools/src/builtins/edit-tool.ts`
- `packages/agent-tools/src/sandbox/assert-within-cwd.ts`

## Completion Criteria

- [ ] TC-01: cwd 밖 경로(예: `/etc/passwd`) 접근 시 "Access denied" 에러 반환
- [ ] TC-02: `bypassPermissions` 모드에서도 경로 검증이 적용됨
- [ ] TC-03: cwd 내부 절대 경로 접근은 허용됨 (기존 동작 유지)
- [ ] TC-04: `../../../.env` 형태의 상대 경로 순회도 차단됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                          | Notes                                            |
| ----- | --------- | ---------------------------------------- | ------------------------------------------------ |
| TC-01 | unit      | vitest — read-tool path guard            | Pass /etc/passwd, expect Access denied error     |
| TC-02 | unit      | vitest — bypassPermissions mode check    | Mock permission mode, verify guard still applies |
| TC-03 | unit      | vitest — cwd-internal path allowed       | Pass cwd-internal absolute path, expect success  |
| TC-04 | unit      | vitest — relative traversal path blocked | Pass ../../../.env, expect Access denied error   |

## Tasks

- [ ] `.agents/tasks/CLI-035.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: SECURITY` is valid from 11-prefix list; `tags: [cli, security, tools]` present.
- Problem section: concrete symptom present (specific files read-tool.ts/write-tool.ts/edit-tool.ts + example paths `/etc/passwd`, `~/.ssh/id_rsa`, `../../../.env`); reproduction condition present (`robota -p "read /etc/passwd"`); no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit evidence (workspace-manifest.ts reference); Alternatives Considered has 2 entries (Alt A, Alt B) each with pro/con; Decision references the trade-off (flexibility vs. actual protection).
- Completion Criteria: all 4 items have TC-N prefix (TC-01–TC-04); each uses observable behavior form; no vague language ("works correctly" etc.) found.
- Test Plan: section present; 4 rows matching 4 TC-N criteria (count matches); all rows have non-empty Test Type (unit) and Tool/Approach (vitest); no manual rows requiring Notes explanation.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count: Completion Criteria = 4, Test Plan rows = 4 — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)
