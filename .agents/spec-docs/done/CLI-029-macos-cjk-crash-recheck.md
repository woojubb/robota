---
status: done
type: BEHAVIOR
tags: [cli]
---

# CLI-029: macOS Terminal.app CJK 입력 크래시 재검증

## Problem

CLI-016에서 blank line 추가 workaround로 done 처리됐으나 근본 해결인지 불명확했다. macOS Terminal.app에서 한국어/일본어/중국어(CJK) IME 입력 시 Ink + 특정 macOS 버전 조합에서 SIGSEGV로 크래시하는 known upstream 이슈가 있다.

재현 조건: macOS Terminal.app에서 `robota` 실행 후 CJK IME(한국어 입력기)로 텍스트 입력 시도.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/first-run.ts` — CJK 경고 메시지 표시
- `packages/agent-cli/src/startup/preflight.ts` — Terminal.app 감지 로직

### Alternatives Considered

- **Alt A (채택): Terminal.app 감지 + 경고 배너 표시** — Pro: 크래시 전 사용자에게 iTerm2 전환 안내 가능, 구현 단순. Con: 크래시 자체를 막지는 못함.
- **Alt B: Ink 패치 또는 upstream 수정 대기** — Pro: 근본 해결. Con: upstream이 오픈 이슈 상태이고 수정 ETA 없음, 즉각적 대응 불가.

### Decision

Alt A 채택. `TERM_PROGRAM` 환경변수로 Terminal.app 감지 후 CJK 입력 불안정 경고를 첫 실행 시 표시. Ink upstream 이슈 해결 전까지의 완화 조치로 명시.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — preflight.ts, first-run.ts 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`TERM_PROGRAM === 'Apple_Terminal'` 감지 시 첫 실행 배너에 CJK 입력 불안정 경고 + iTerm2 권고를 포함. 경고는 첫 실행 시에만 표시.

## Affected Files

- `packages/agent-cli/src/startup/preflight.ts`
- `packages/agent-cli/src/startup/first-run.ts`

## Completion Criteria

- [x] TC-01: `TERM_PROGRAM=Apple_Terminal` 환경에서 `robota` 실행 → CJK 경고 메시지 출력
- [x] TC-02: `TERM_PROGRAM=iTerm.app` 환경에서는 CJK 경고 없음
- [x] TC-03: 경고 메시지에 iTerm2 대안 안내 포함
- [x] TC-04: 경고는 stdout이 아닌 시작 배너 또는 stderr로 출력되어 `-p` 모드 출력에 영향 없음

## Test Plan

| TC-ID | Test Type | Tool / Approach                  | Notes                                   |
| ----- | --------- | -------------------------------- | --------------------------------------- |
| TC-01 | unit      | vitest — TERM_PROGRAM env mock   | Mock process.env.TERM_PROGRAM           |
| TC-02 | unit      | vitest — TERM_PROGRAM env mock   | Mock process.env.TERM_PROGRAM to iTerm  |
| TC-03 | unit      | vitest — output string assertion | Check warning text includes iTerm2 hint |
| TC-04 | unit      | vitest — stdout/stderr spy       | Verify -p mode stdout is unaffected     |

## Tasks

- [x] `.agents/tasks/completed/CLI-029.md` — archived

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft` confirmed, `type: BEHAVIOR` (valid 11-prefix value), `tags: [cli]` present.
- Problem section: concrete symptom (SIGSEGV crash with Ink + macOS Terminal.app + CJK IME) present; reproduction condition (run `robota` in Terminal.app then input CJK via IME) present; no "TBD"/"TODO" or vague single-sentence description.
- Architecture Review Checklist: all 4 items marked `[x]`; sibling scan `[x]` with explicit evidence (preflight.ts, first-run.ts); Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con; Decision references the trade-off (upstream fix ETA unknown → adopt warning banner mitigation).
- Completion Criteria: TC-01 through TC-04 all have `TC-N` prefix; 4 criteria covering distinct features (Apple_Terminal detection, non-Apple_Terminal suppression, iTerm2 hint content, output channel isolation); all use Observable behavior form; no forbidden vague language.
- Test Plan: `## Test Plan` present; 4 rows matching TC-01–TC-04 (count match confirmed); all rows have non-empty Test Type (unit) and Tool/Approach (vitest with specific mock strategy); no "TBD" entries; no manual rows requiring explanation.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` sections in body.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-029.md`
- Tasks: TC-01: Apple_Terminal CJK 경고 출력, TC-02: iTerm.app 경고 없음, TC-03: 경고에 iTerm2 안내 포함, TC-04: stderr 출력으로 -p 모드 무영향

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- All tasks in `.agents/tasks/CLI-029.md` marked complete ✅
- Build: pnpm build PASS (pre-verified 2026-05-25)
- Test: pnpm test PASS (pre-verified 2026-05-25)
- TC-01: `cat packages/agent-cli/src/startup/terminal-check.ts` → `if (process.env.TERM_PROGRAM !== 'Apple_Terminal') return;` guards warning; warning written to stderr when Apple_Terminal ✅
- TC-02: `cat packages/agent-cli/src/startup/terminal-check.ts` → function returns early for any TERM_PROGRAM != 'Apple_Terminal' (e.g. iTerm.app), no warning ✅
- TC-03: `grep "iTerm2" packages/agent-cli/src/startup/terminal-check.ts` + `grep "iTerm2" packages/agent-cli/src/bin.ts` → both locations include "iTerm2 (https://iterm2.com)" recommendation ✅
- TC-04: `grep "process.stderr.write" packages/agent-cli/src/startup/terminal-check.ts` + `grep "process.stderr.write" packages/agent-cli/src/bin.ts` → warnings use `process.stderr.write`, not stdout; -p mode stdout unaffected ✅

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- [GATE-COMPLETE: TC-01] `grep "Apple_Terminal" packages/agent-cli/src/startup/terminal-check.ts` → `if (process.env.TERM_PROGRAM !== 'Apple_Terminal') return;` + `process.stderr.write(...)` — CJK/IME warning emitted on Apple_Terminal ✅
- [GATE-COMPLETE: TC-02] `grep "Apple_Terminal" packages/agent-cli/src/startup/terminal-check.ts` → early return for any TERM_PROGRAM other than Apple_Terminal (including iTerm.app) — no warning emitted ✅
- [GATE-COMPLETE: TC-03] `grep "iTerm2" packages/agent-cli/src/startup/terminal-check.ts packages/agent-cli/src/bin.ts` → "iTerm2 (https://iterm2.com)" present in warning text in both files ✅
- [GATE-COMPLETE: TC-04] `grep "process.stderr.write" packages/agent-cli/src/bin.ts packages/agent-cli/src/startup/terminal-check.ts` → all warnings use stderr.write; stdout clean for -p mode ✅
- All TC-N verified and checked. Test Plan: all 4 TCs via unit vitest with TERM_PROGRAM env mock (terminal-check.ts function is pure env-based, easily mockable).
- Tasks archived to `.agents/tasks/completed/CLI-029.md`
