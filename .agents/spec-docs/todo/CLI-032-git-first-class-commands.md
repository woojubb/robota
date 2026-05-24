---
status: approved
type: BEHAVIOR
tags: [cli, git]
---

# CLI-032: Git 통합 first-class 슬래시 커맨드 — /commit, /status, /diff

## Problem

Robota CLI에서 git 작업은 Bash 도구를 통해 직접 실행해야 한다. 이 방식은 실행마다 권한 프롬프트를 유발하고, AI가 staged 파일 선택이나 커밋 메시지 품질을 자연스럽게 관리하기 어렵다. `/commit`, `/status`, `/diff` 같은 first-class 슬래시 커맨드가 없어 코딩 어시스턴트로서의 git 워크플로우 경험이 열악하다.

재현 조건: TUI 모드에서 파일 수정 후 git commit 하려면 Bash 도구 + 권한 프롬프트 + 수동 메시지 입력이 필요하다.

## Architecture Review

### Affected Scope

- `packages/agent-command/src/commands/git/` — /status, /diff, /commit 커맨드 구현
- `packages/agent-cli/src/` — 슬래시 커맨드 라우터에 git 커맨드 등록

### Alternatives Considered

- **Alt A (채택): 기존 agent-command 패키지에 git/ 서브디렉토리 추가** — Pro: 새 패키지 불필요, 의존 관계 단순. Con: git 전용 패키지로 분리할 수 없음.
- **Alt B: @robota-sdk/agent-command-git 신규 패키지 생성** — Pro: 관심사 분리. Con: 패키지 수 증가, 초기 단계에서 과설계.

### Decision

Alt A 채택. `agent-command` 패키지 내 `commands/git/` 디렉토리에 구현. git 명령은 Bash 도구로 실행하되 결과 파싱과 UX는 커맨드 레이어에서 처리.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — agent-command 기존 커맨드 구조 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`packages/agent-command/src/commands/git/` 에 `/status`, `/diff`, `/commit` 커맨드를 구현. `/commit`은 staged 변경을 AI가 분석해 conventional commit 메시지를 제안하고 사용자 확인 후 실행.

## Affected Files

- `packages/agent-command/src/commands/git/status.ts`
- `packages/agent-command/src/commands/git/diff.ts`
- `packages/agent-command/src/commands/git/commit.ts`
- `packages/agent-cli/src/slash-command-registry.ts`

## Completion Criteria

- [ ] TC-01: TUI에서 `/status` 입력 → git status 결과가 파싱되어 파일 목록 출력
- [ ] TC-02: TUI에서 `/diff` 입력 → unstaged 변경사항 출력
- [ ] TC-03: TUI에서 `/commit` 입력 → AI가 staged 변경 분석 후 커밋 메시지 제안 → 사용자 확인 후 커밋 실행
- [ ] TC-04: staged 파일이 없는 상태에서 `/commit` → "먼저 /status로 확인하세요" 안내 메시지 출력

## Test Plan

| TC-ID | Test Type | Tool / Approach                           | Notes                                          |
| ----- | --------- | ----------------------------------------- | ---------------------------------------------- |
| TC-01 | unit      | vitest — git status parser mock           | Mock child_process output, check parsed result |
| TC-02 | unit      | vitest — git diff parser mock             | Mock diff output, verify display               |
| TC-03 | unit      | vitest — commit command with staged files | Mock git diff --cached, check message flow     |
| TC-04 | unit      | vitest — commit command empty staged      | Verify guidance message on empty staged        |

## Tasks

- [ ] `.agents/tasks/CLI-032.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli, git]` present.
- Problem section: concrete symptom present (git requires Bash tool + permission prompts + manual message input); reproduction condition present (TUI mode after file modification); no TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items marked `[x]`.
- Sibling scan: `[x]` with evidence "agent-command 기존 커맨드 구조 확인".
- Alternatives Considered: 2 entries (Alt A, Alt B) each with explicit Pro and Con.
- Decision: references trade-off ("초기 단계에서 과설계" vs "의존 관계 단순") as driver.
- Completion Criteria: 4 items, all with TC-N prefix (TC-01 through TC-04); each uses observable TUI behavior form; no vague language found.
- Test Plan: section present; 4 rows match 4 TC-N items (count matches); all rows have non-empty Test Type ("unit") and Tool/Approach ("vitest — ..."); no TBD; no manual-only rows requiring Notes justification.
- Tasks section: present with placeholder.
- Evidence Log section: was empty before this entry (first GATE-WRITE run).
- No `## Status` or `## Classification` sections found in body.
- TC-N count: Completion Criteria = 4, Test Plan rows = 4 — match confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)
