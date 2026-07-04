---
title: 'INFRA-027: 구조 위생 잔여: devDep 역참조·부패 examples/·문서 표기'
status: todo
created: 2026-07-04
priority: low
urgency: later
area: packages/agent-transport, packages/agent-core, .agents
depends_on: ['HARNESS-022']
---

# 구조 위생 잔여: devDep 역참조·부패 examples/·문서 표기

Re-audit P3 (STRUCT-05/06/09; STRUCT-04는 TYPE-003 흡수). transport→command devDep 역참조 2건,
패키지 내부 examples/ 부패(core examples 미선언 provider import, session examples 부재 패키지
참조), project-structure.md subagent-runner 괄호 표기 불일치.

## What

1. 역참조 통합 테스트 소비자 측 이동(또는 dev 순환 게이트 봉인 확인).
2. 패키지 내부 examples/ 루트 이관 또는 삭제(레이아웃 SSOT).
3. 문서 괄호 표기 전수 갱신.

## Test Plan

- build:deps + 전체 스캔 green; 이관 examples 컴파일 확인.

## User Execution Test Scenarios

Not applicable — metadata/docs/test-layout only. 대체 검증: build+scan green.
