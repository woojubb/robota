---
status: done
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

- [x] TC-01: cwd 밖 경로(예: `/etc/passwd`) 접근 시 "Access denied" 에러 반환
- [x] TC-02: `bypassPermissions` 모드에서도 경로 검증이 적용됨
- [x] TC-03: cwd 내부 절대 경로 접근은 허용됨 (기존 동작 유지)
- [x] TC-04: `../../../.env` 형태의 상대 경로 순회도 차단됨

## Test Plan

| TC-ID | Test Type | Tool / Approach                          | Notes                                                                  |
| ----- | --------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| TC-01 | unit      | vitest — read-tool path guard            | `path-guard.test.ts` "returns error JSON for path outside cwd" ✅      |
| TC-02 | unit      | vitest — bypassPermissions mode check    | `read-tool.ts` L116: unconditional guard, no permission-mode branch ✅ |
| TC-03 | unit      | vitest — cwd-internal path allowed       | `path-guard.test.ts` "returns undefined for path inside cwd" ✅        |
| TC-04 | unit      | vitest — relative traversal path blocked | `path-guard.test.ts` "returns error JSON for path with traversal" ✅   |

## Tasks

- [x] `.agents/tasks/completed/CLI-035.md` — archived

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

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-035.md`
- Tasks: TC-01: cwd 밖 경로 접근 시 "Access denied" 에러 반환, TC-02: `bypassPermissions` 모드에서도 경로 검증이 적용됨, TC-03: cwd 내부 절대 경로 접근은 허용됨, TC-04: `../../../.env` 형태의 상대 경로 순회도 차단됨

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- All tasks in `.agents/tasks/CLI-035.md` marked complete ✅
- Build: pnpm build PASS (pre-verified 2026-05-25)
- Test: pnpm test PASS (pre-verified 2026-05-25)
- TC-01: `packages/agent-tools/src/__tests__/path-guard.test.ts` "returns error JSON for path outside cwd" — passes `/etc/passwd`, asserts `parsed.error` matches `/outside the working directory/` → PASS
- TC-02: `read-tool.ts` L116, `write-tool.ts` L26, `edit-tool.ts` L40 — all call `checkPathWithinCwd` unconditionally, no branch on `bypassPermissions`; guard is always applied → PASS
- TC-03: `path-guard.test.ts` "returns undefined for path inside cwd" and "returns undefined for deeply nested path inside cwd" → PASS
- TC-04: `path-guard.ts` uses `resolve()` to normalise relative traversal; any `../../../.env` resolving outside `cwd` is blocked; `path-guard.test.ts` "returns error JSON for path with traversal" → PASS

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- Tasks archived: `.agents/tasks/completed/CLI-035.md`
- TC-01: `/etc/passwd` 접근 시 "Access denied" 에러 — `path-guard.test.ts` confirmed → ✅
- TC-02: `bypassPermissions` 모드에서도 경로 검증 적용 — unconditional call in read/write/edit-tool.ts → ✅
- TC-03: cwd 내부 절대 경로 허용 — `path-guard.test.ts` "returns undefined for path inside cwd" → ✅
- TC-04: `../../../.env` 상대 경로 순회 차단 — `resolve()` normalisation + `path-guard.test.ts` traversal test → ✅
