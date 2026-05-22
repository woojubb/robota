---
title: 'CLI-010: robota init — 프로젝트 AGENTS.md 및 .robota/settings.json 초기화 마법사'
status: todo
created: 2026-05-23
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---

## Background

새 프로젝트에서 robota 설정을 처음 만들려면 파일 형식을 직접 파악하고 작성해야 한다. Claude Code 사용자의 전환 마찰이 높다.

## 작업 항목

- `robota init` 서브커맨드 추가
- 인터랙티브 마법사로 진행:
  1. 프로젝트 유형 선택 (Node.js 백엔드, React/Next.js, Python, 기타)
  2. 팀 사용 여부 (팀 공유 설정 포함 여부)
  3. 기본 공급자 선택
- 선택에 따라 맞춤형 `AGENTS.md`, `.robota/settings.json` 생성
- Claude Code `.claude/` 디렉토리가 존재하면 "마이그레이션" 옵션 제공
- 기존 파일이 있을 경우 덮어쓰기 여부 확인

## Test Plan

- `robota init` 후 AGENTS.md, settings.json 생성 확인
- Claude Code 마이그레이션 경로 확인

## User Execution Test Scenarios

### Scenario 1: 신규 프로젝트 초기화

```bash
cd my-project
robota init
```

Expected: AGENTS.md와 .robota/settings.json 생성
