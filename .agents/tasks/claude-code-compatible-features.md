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

## 리서치 계획

각 기능 구현 전 Claude Code 오픈소스 코드 및 문서에서 정확한 인터페이스를 확인해야 한다.

### 리서치 소스

- Claude Code GitHub: https://github.com/anthropics/claude-code
- Claude Code 공식 문서: https://docs.anthropic.com/en/docs/claude-code
- Claude Code 소스 코드 직접 분석 (설정 파일 파서, 디렉토리 스캔 로직)

### 기능별 리서치 항목

**Marketplace:**
- marketplace가 존재하는지, API 엔드포인트가 있는지
- 리소스 검색/설치 CLI 명령어 (`claude install` 등)
- 설치된 리소스의 디렉토리 구조 (`~/.claude/` 하위)
- 리소스 매니페스트 포맷 (package.json 등)

**Plugin:**
- `.claude/plugins/` 또는 유사 디렉토리 존재 여부
- plugin 인터페이스 (export해야 하는 함수/클래스)
- plugin lifecycle: 로드 시점, 실행 시점, 에러 처리
- plugin 설정 (`settings.json`의 plugins 섹션 구조)
- Robota의 기존 AbstractPlugin과의 매핑 가능성

**Hook:**
- `settings.json`의 hooks 섹션 정확한 JSON 스키마
- 지원되는 hook 이벤트 전체 목록 (PreToolUse, PostToolUse 외)
- hook matcher 패턴 문법 (glob, regex, tool name 매칭)
- hook command 실행 환경 (환경변수, stdin/stdout, exit code 처리)
- Robota의 현재 hook 구현(`agent-core/runHooks`)과의 차이점

**Command:**
- `.claude/commands/` 디렉토리 구조 및 파일 포맷 (markdown? yaml?)
- command frontmatter 필드 (name, description, arguments)
- command 실행 방식: prompt injection vs function call
- 인자 처리: positional args, `$ARGUMENTS` 변수 등
- Robota의 현재 skill 시스템(`.agents/skills/`)과의 차이점 및 통합 전략

### 리서치 방법

1. Claude Code GitHub에서 소스 코드 검색 (설정 파서, 디렉토리 스캐너)
2. 공식 문서에서 사용자 가이드 확인
3. 실제 Claude Code 설치 후 디렉토리 구조 확인
4. 각 기능별 리서치 결과를 `.design/` 문서로 기록
5. Robota 기존 구현과의 gap 분석 후 구현 계획 수립
