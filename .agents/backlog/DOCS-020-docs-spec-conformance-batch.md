---
title: 'DOCS-020: 문서/SPEC 정합 배치: 자기모순·오귀속·미수출 API 안내 일소'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: packages, content
depends_on: ['HARNESS-022', 'ARCH-004']
---

# 문서/SPEC 정합 배치: 자기모순·오귀속·미수출 API 안내 일소

Re-audit P2-13 (DOCS-1~7 + CONTRACT-008/009/010/017/018/019/020; CONTRACT-020⊂DOCS-2/4). 전부
prose 레벨(스캔 커버 ts 블록 깨진 import 0 실측). framework SPEC 자기모순, 오귀속
(ITransportAdapter 등), 미수출 createSession()·부재 SessionManager 안내, transport README 허위
재수출 주장, agent-cli SPEC 의존 표 절반 누락, interface-transport SPEC 부재 export 4종.

## What

1. 발견 전건 수정(SPEC 6+, README 4+, content/guide 2+, migration.md).
2. 선행 제공 표면 문서는 ARCH-004 하드닝 결과 기준 정확화.
3. 구식 API 전체 grep 재실행 0건 확인.

## Test Plan

- harness:scan(doc-examples/specs/docs-structure) green; 오귀속 심볼 전수 grep 0.

## User Execution Test Scenarios

Not applicable — prose 전용 문서 정합. 대체 검증: 스캔 green + 구식 API grep 0건.
