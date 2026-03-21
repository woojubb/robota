---
title: Claude Code 호환 기능 구현 (marketplace, plugin, hook, command)
status: backlog
priority: high
created: 2026-03-22
packages:
  - agent-cli
  - agent-sdk
  - agent-core
---

# Claude Code 호환 기능 구현

## 개요

Claude Code와 호환되는 4가지 확장 기능을 구현하여, Claude Code 생태계의 리소스를 Robota CLI에서 활용할 수 있도록 한다.

## 기능 목록

### 1. Marketplace 호환

- Claude Code marketplace에서 제공하는 리소스(skills, plugins, hooks) 검색/설치
- `.claude/` 디렉토리 구조 호환
- 리서치 필요: Claude Code marketplace API, 리소스 포맷, 설치 경로

### 2. Plugin 호환

- Claude Code plugin 포맷 지원
- plugin 로드/실행 메커니즘
- lifecycle hooks (beforeRun, afterRun 등) 연동
- 리서치 필요: Claude Code plugin 인터페이스, 로딩 방식, 설정 구조

### 3. Hook 호환

- Claude Code hook 시스템과 호환
- PreToolUse, PostToolUse, SessionStart, Stop 등 기존 hook 이벤트
- shell command 기반 hook 실행 (현재 agent-core에 구현되어 있음)
- 리서치 필요: Claude Code hook 설정 포맷 차이점, 추가 이벤트

### 4. Command 호환

- Claude Code 커스텀 command 포맷 지원
- `.claude/commands/` 디렉토리에서 커스텀 명령어 디스커버리
- 현재 skill 시스템(`.agents/skills/`)과의 통합 또는 공존
- 리서치 필요: Claude Code command 포맷, 인자 처리, 실행 방식

## 사전 리서치 필요

각 기능 구현 전 Claude Code 오픈소스 코드 및 문서에서 정확한 인터페이스를 확인해야 함:
- https://github.com/anthropics/claude-code
- https://docs.anthropic.com/en/docs/claude-code
- Claude Code 설정 파일 구조 (`.claude/settings.json`, `.claude/commands/`, `.claude/plugins/`)
