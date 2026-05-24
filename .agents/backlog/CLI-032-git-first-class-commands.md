---
title: 'CLI-032: Git 통합 first-class 슬래시 커맨드 — /commit, /status, /diff'
status: todo
created: 2026-05-24
priority: medium
urgency: soon
area: packages/agent-command, packages/agent-cli
depends_on: []
---

## Background

AI 코딩 어시스턴트의 핵심 워크플로우는 코드 수정 → git commit → push다. 현재 Robota CLI에서는 Bash 도구로 `git commit -m "..."` 을 직접 실행해야 한다. Bash 도구 실행은 권한 프롬프트를 유발하고, 커밋 메시지 품질이나 staged 파일 선택을 AI가 자연스럽게 관리하기 어렵다.

Aider는 git 자동 커밋이 핵심 강점이다. Robota CLI도 git 통합을 first-class로 제공해야 코딩 어시스턴트로서 경쟁력이 있다.

## 작업 항목

### /status

```
/status
→ git status 결과를 파싱해서 TUI 친화적 형태로 표시
   변경된 파일, staged 파일, untracked 파일을 색으로 구분
```

### /diff [범위]

```
/diff              → git diff (unstaged)
/diff --staged     → git diff --cached
/diff HEAD~1       → 이전 커밋과 비교
→ diff 결과를 코드 하이라이팅과 함께 표시
→ 선택적: AI에게 "이 diff의 변경 요약을 해줘" 자동 전달
```

### /commit [메시지]

```
/commit                    → AI가 staged 변경을 보고 커밋 메시지 제안 → 확인 후 커밋
/commit "feat: add login"  → 지정한 메시지로 바로 커밋
→ 권한: 기본적으로 confirmEach (git 커밋은 중요한 작업)
→ staged 파일이 없으면 "먼저 /status로 확인하세요" 안내
```

## 구현 방식

`@robota-sdk/agent-command-git` 패키지 생성 또는 기존 command 패키지 확장.
git 명령은 Bash 도구를 통해 실행하되, 결과 파싱과 UX는 커맨드 레벨에서 처리.

## 성공 기준

- `/status` → 색깔 구분된 git status 표시
- `/diff` → 코드 하이라이팅된 diff 표시
- `/commit` → AI가 staged 변경 분석 후 conventional commit 형식 메시지 제안 → 사용자 확인 → 실제 커밋
