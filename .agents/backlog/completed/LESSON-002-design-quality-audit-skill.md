---
title: 'LESSON-002: 설계 품질 심층 감사 스킬 신설 — conformance 감사와 분리'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: high
urgency: soon
area: .agents/skills/design-quality-audit
depends_on: []
---

# LESSON-002: 설계 품질 심층 감사 스킬 신설

## Problem (이번 세션 실제 사건)

이번 세션에서 "설계 품질 심층 감사"를 수행해 17건의 findings(DQ-01~DQ-17)를 도출하고
DQ-AUDIT-001~007로 백로그화·구현했다. 그러나 이 감사는 **반복 가능한 스킬 없이 ad-hoc로**
진행되었다.

기존 `architecture-conformance-audit` 스킬은 **문서↔코드 정합성(doc-vs-code drift)**만 검증한다.
설계 품질 차원 — 레이어 경계, 결합도/응집도, 책임 배치, 타입 SSOT, 확장 seam, 안티패턴 —
은 다루지 않는다. 두 감사는 명확히 다른 축이며, 설계 품질 감사를 다음에 다시 하려면
이번에 쓴 절차가 스킬로 남아있어야 한다.

## Solution

`design-quality-audit` 스킬 신설:

- conformance 감사와의 **명시적 구분**(무엇을 보지 않는지 포함).
- 감사 축 체크리스트: 레이어 경계 위반, 양방향/역방향 의존, 결합도·응집도, 책임 오배치,
  타입 SSOT 위반, 확장 seam 부재, fallback/하드코딩/raw throw 등 안티패턴.
- findings → 심각도(P0~P3) 분류 → 백로그 매핑 절차(이번 DQ-AUDIT 분해 방식 레퍼런스).
- 가능한 부분은 기존 기계적 검사(orphan-export, interface-imports, capability-placement,
  dependency-direction)로 연결.
- `.agents/skills/index.md` "Architecture Conformance" 또는 신규 "Design Quality" 그룹에 등재.

## Completion Criteria

- [x] TC-01: `.agents/skills/design-quality-audit/SKILL.md` 생성 — 감사 축, 심각도 분류,
      백로그 매핑 절차 포함
- [x] TC-02: conformance 감사와의 구분(다루는/안 다루는 범위)이 명시됨
- [x] TC-03: `.agents/skills/index.md`에 등재
- [x] TC-04: harness-governance 규칙-스킬 일관성 검사 + `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                                            |
| ----- | ---------- | --------------------------------------------------- |
| TC-01 | Doc review | SKILL.md 필수 절 존재 확인                          |
| TC-02 | Doc review | conformance 스킬과 cross-link + 범위 구분 문구 확인 |
| TC-03 | Doc review | index.md 항목 추가 확인                             |
| TC-04 | Harness    | `pnpm harness:scan` 통과 (undefined terminology 등) |

## User Execution Test Scenarios

Not applicable — 스킬(절차 문서) 신설. 사용자 대면 런타임 동작 무변경.

## Tasks

- [x] SKILL.md 작성 → index.md 등재 → harness:scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01:** `.agents/skills/design-quality-audit/SKILL.md` 생성 — 6개 감사 축(레이어 경계,
  결합/응집, 책임 배치, 타입 SSOT, 확장 seam, 안티패턴), 심각도 분류(P0~NIT/`DQ-NN`),
  백로그 매핑 절차, 재배치 sweep 절(LESSON-006 연계). 2026-06-14 DQ 감사를 exemplar로 참조.
- **TC-02:** "This Skill vs. architecture-conformance-audit" 비교표로 doc-conformance(드리프트)
  vs design-quality(품질) 축을 명시하고 "What This Skill Does NOT Do"로 범위 구분.
- **TC-03:** `.agents/skills/index.md` "Architecture Conformance" 그룹에 등재.
- **TC-04:** anchor 형식 정합화 후 `scan-consistency` 통과 → `pnpm harness:scan` **26/26 passed**.

User Execution Test Scenario gate: Not applicable — 절차 문서(스킬) 신설(런타임 동작 무변경).
