---
title: 'CLI-025: 프로바이더 핫 스왑 — 재시작 없이 동적 전환'
status: done
created: 2026-05-23
priority: low
urgency: later
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

## Background

현재 `/model` 또는 `/provider` 커맨드로 프로바이더를 전환하면 CLI가 재시작된다. 재시작 시 세션 히스토리가 보존되지 않아 장기 세션에서 모델 전환이 불편하다.

특히 "Anthropic으로 코드 분석 → OpenAI로 문서 작성" 같은 멀티 프로바이더 워크플로우에서 중단 없는 전환이 필요하다.

## 작업 항목

- `InteractiveSession`에서 프로바이더 전환 시 재시작 없이 동적으로 교체할 수 있는 메커니즘 설계
  - 현재 세션 히스토리를 새 프로바이더에 그대로 이어받는 컨텍스트 전달 방식
  - 메시지 포맷 호환성 문제 처리 (vision 파트 등 프로바이더별 미지원 기능 제거)
- `/provider switch <name>` 또는 `/model <provider>/<model>` 형식으로 UX 개선
- 전환 후 히스토리 요약(compaction)을 선택적으로 실행하는 옵션 제공
- 아키텍처 변경이 크므로 설계 문서(`.design/`) 작성 후 사용자 승인 필요

## Test Plan

- `/provider switch openai` 실행 후 세션 재시작 없이 이전 대화 컨텍스트 유지 확인
- 이전 프로바이더 히스토리가 새 프로바이더 포맷에 맞게 변환되는지 확인
- 기존 `/model` 커맨드 회귀 없음 확인

## User Execution Test Scenarios

### Scenario 1: 프로바이더 전환 후 컨텍스트 유지

```
> 이 코드 파일을 분석해줘  [Anthropic으로 응답]
> /provider switch openai
> 방금 분석한 코드를 기반으로 README를 작성해줘  [세션 재시작 없이 컨텍스트 유지]
```

Expected: 재시작 없이 이전 대화 컨텍스트를 이어받아 새 프로바이더가 응답
