---
status: review-ready
type: SECURITY
tags: [cli, security]
---

# CLI-037: --api-key 플래그 셸 히스토리 노출 경고

## Problem

`robota --api-key sk-ant-xxxxx` 형태로 사용하면 API 키가 `~/.zsh_history`에 평문으로 기록된다. `packages/agent-cli/src/utils/cli-args.ts`에 `--api-key` 플래그가 정의되어 있지만 히스토리 노출 위험을 사용자에게 경고하지 않는다.

재현 조건: `robota --api-key sk-ant-xxx chat` 실행 후 `history | grep robota` → API 키가 히스토리에 노출된다.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/startup/args-to-options.ts` — `--api-key` 감지 시 경고 출력
- `packages/agent-cli/README.md` — 환경변수 보안 권고 추가

### Alternatives Considered

- **Alt A (채택): --api-key 사용 시 stderr 경고 + --api-key-env 대안 안내** — Pro: 즉각적인 사용자 인지, 구현 단순. Con: 경고를 무시하는 사용자는 여전히 위험에 노출.
- **Alt B: --api-key 플래그 제거, 환경변수만 허용** — Pro: 근본 차단. Con: 스크립트에서 환경변수 없이 플래그로 사용하는 기존 사용자에게 브레이킹 체인지.

### Decision

Alt A 채택. 미배포 프로젝트이지만 `--api-key` 플래그는 정당한 사용 사례(CI 환경 주입)가 있다. 경고를 통해 인지시키고 더 안전한 대안인 `--api-key-env`를 안내한다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — cli-args.ts, args-to-options.ts 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`args-to-options.ts`에서 `--api-key` 플래그가 사용된 경우 stderr에 경고 메시지 출력. `--api-key-env ANTHROPIC_API_KEY` 대안 안내 포함.

## Affected Files

- `packages/agent-cli/src/startup/args-to-options.ts`
- `packages/agent-cli/README.md`

## Completion Criteria

- [ ] TC-01: `--api-key` 플래그 사용 시 stderr에 히스토리 노출 경고 메시지 출력
- [ ] TC-02: 경고 메시지에 `--api-key-env` 대안 사용법 포함
- [ ] TC-03: `--api-key-env` 사용 시 경고 없음
- [ ] TC-04: 경고는 stderr로만 출력 (stdout에 영향 없어 파이프 사용 시 안전)

## Test Plan

| TC-ID | Test Type | Tool / Approach                       | Notes                                           |
| ----- | --------- | ------------------------------------- | ----------------------------------------------- |
| TC-01 | unit      | vitest — args-to-options warning mock | Pass --api-key, check stderr warning emitted    |
| TC-02 | unit      | vitest — warning message content      | Check warning includes --api-key-env suggestion |
| TC-03 | unit      | vitest — api-key-env no warning       | Pass --api-key-env, verify no warning           |
| TC-04 | unit      | vitest — stderr vs stdout spy         | Verify warning goes to stderr only              |

## Tasks

- [ ] `.agents/tasks/CLI-037.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present, `status: draft`, `type: SECURITY` (valid from 11-prefix list), `tags: [cli, security]` present.
- Problem section: concrete symptom (`robota --api-key sk-ant-xxxxx` → `~/.zsh_history` 평문 기록) and reproduction condition (`robota --api-key sk-ant-xxx chat` 실행 후 `history | grep robota`) documented; no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with evidence "cli-args.ts, args-to-options.ts 구조 확인"; Alternatives Considered has 2 entries (Alt A, Alt B) each with pro/con; Decision references trade-off (legitimate CI use case + breaking change concern for Alt B).
- Completion Criteria: 4 items (TC-01–TC-04), all have TC-N prefix, all use observable behavior form, no vague language ("works correctly" etc.).
- Test Plan: section present; 4 rows matching TC-01–TC-04 (count matches); all rows have non-empty Test Type ("unit") and Tool/Approach (vitest); no manual rows requiring Notes justification.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty before this entry; no `## Status` or `## Classification` sections in body.
- TC-N count check: Completion Criteria = 4 (TC-01–TC-04), Test Plan rows = 4 (TC-01–TC-04). Counts match.
