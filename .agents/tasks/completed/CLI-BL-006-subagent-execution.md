---
title: CLI-BL-006 Subagent execution for skills/commands/agents
status: backlog
priority: high
created: 2026-03-23
packages:
  - agent-cli
  - agent-sdk
  - agent-sessions
---

## 요약

Skills/commands의 `context: fork`와 plugin agents/ 디렉토리를 통한 서브에이전트 실행 구현. Claude Code와 동일한 에이전트 기능 지원.

## 리서치 결과 (2026-03-23)

### Skills/Commands 에이전트 기능

- Skills와 Commands는 동일한 에이전트 기능 지원
- `context: fork` → 새 격리된 context window에서 서브에이전트 실행
- `agent` 필드 → 빌트인(Explore/Plan/general-purpose) 또는 커스텀 에이전트
- `allowed-tools` → skill 활성 중 auto-approve
- `model` → 서브에이전트 모델 오버라이드

### 에이전트 정의 (agents/ 디렉토리)

```markdown
---
name: agent-name
description: What this agent specializes in
model: sonnet
effort: medium
maxTurns: 20
disallowedTools: Write, Edit
---

System prompt for the agent.
```

지원 필드: name, description, model, effort, maxTurns, tools, disallowedTools, skills, memory, background, isolation

### 빌트인 에이전트 타입

| 타입            | 모델  | 도구                      | 용도                 |
| --------------- | ----- | ------------------------- | -------------------- |
| Explore         | Haiku | 읽기 전용 (no Write/Edit) | 코드베이스 탐색/분석 |
| Plan            | 상속  | 읽기 전용                 | 계획 수립 리서치     |
| general-purpose | 상속  | 전체                      | 복잡한 다단계 작업   |

### 서브에이전트 실행 모델

- 부모 대화 히스토리 접근 불가 (격리)
- SKILL.md 내용 = 서브에이전트 프롬프트
- CLAUDE.md는 로드됨
- 결과 요약되어 부모에 반환
- 서브에이전트가 다른 서브에이전트 생성 불가
- foreground: 부모 대화 차단, permission prompt 사용자에게 전달
- background: 병렬 실행, permission 사전 승인

### 호출 방법

1. `/skill-name` (context: fork인 skill)
2. AI 자동 위임 (description 기반)
3. @-mention (`@"agent-name"`)
4. `--agent` CLI 플래그
5. settings.json의 `agent` 필드

## 구현 필요 항목

1. **`context: fork` 실제 실행** — 현재 callback 인터페이스만 있음, 실제 session 생성 필요
2. **agents/ 디렉토리 파싱** — markdown frontmatter로 에이전트 정의 로드
3. **빌트인 에이전트 타입 구현** — Explore(읽기전용), Plan(읽기전용), general-purpose
4. **도구 제한** — tools/disallowedTools 필드로 서브에이전트 도구 제어
5. **모델 오버라이드** — agent/skill의 model 필드로 서브에이전트 모델 변경
6. **결과 반환** — 서브에이전트 완료 시 요약 생성하여 부모에 반환
7. **transcript 저장** — 서브에이전트 대화 로그 별도 저장
