---
title: 'DOC2-003: GitHub 이슈/PR 템플릿 없음 — 베타 출시 후 커뮤니티 지원 준비 미완'
status: todo
created: 2026-05-10
priority: low
urgency: soon
area: documentation
source: pm-prelaunch-report-2026-05-10-v2 (PM-I-004)
---

## Problem

`.github/` 디렉토리에 `CODEOWNERS`, `workflows/`, `lighthouse/`만 존재.
`ISSUE_TEMPLATE/`과 `PULL_REQUEST_TEMPLATE.md`가 없다.

`CONTRIBUTING.md`는 존재하지만 이슈 템플릿 없이는 버그 리포트 시 필수 정보(Node.js 버전,
OS, 터미널, 프로바이더, 오류 메시지) 수집이 안 된다. 베타 출시 후 노이즈 이슈가 많아지고
대응 비용이 높아진다.

## Required Change

### 1. `.github/ISSUE_TEMPLATE/bug_report.md`

```markdown
---
name: Bug Report
about: Report a bug in Robota
labels: bug
---

**Environment**

- Robota version: (run `robota --version`)
- Node.js version: (run `node --version`)
- OS: (macOS / Linux / Windows)
- Terminal: (iTerm2 / Terminal.app / Windows Terminal / other)
- AI Provider: (OpenAI / Anthropic / Google / other)

**Description**
A clear description of the bug.

**Steps to Reproduce**

1.
2.
3.

**Expected Behavior**

**Actual Behavior**

**Error Output** (if any)
\`\`\`
paste error output here
\`\`\`
```

### 2. `.github/ISSUE_TEMPLATE/feature_request.md`

기본 기능 요청 템플릿 (문제 설명, 원하는 동작, 대안 검토).

### 3. `.github/PULL_REQUEST_TEMPLATE.md` (선택)

변경 유형, 테스트 확인, 관련 이슈 링크.

## Scope

- `.github/ISSUE_TEMPLATE/bug_report.md` — 신규 생성
- `.github/ISSUE_TEMPLATE/feature_request.md` — 신규 생성
- `.github/PULL_REQUEST_TEMPLATE.md` — 선택적 신규 생성

## Test Plan

- `.github/ISSUE_TEMPLATE/` 디렉토리 및 파일 존재 확인
- GitHub UI에서 새 이슈 생성 시 템플릿 선택 화면 표시 확인

## User Execution Test Scenarios

Not applicable — GitHub 저장소 UI 전용 변경. 로컬 CLI/TUI 동작 없음.

## Verification Evidence

변경 후:

```bash
ls .github/ISSUE_TEMPLATE/
# Expected: bug_report.md  feature_request.md
```

**Evidence:** (구현 후 기록)
