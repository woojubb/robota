---
status: draft
type: INFRA
tags: [infra, docs]
---

# HARNESS-094: 분류표는 아무도 검사하지 않는다 — 표와 산출물이 어긋나도 초록이다

## Problem

`RULE-013`은 SPEC/design 배치 기준을 세우고, 그 기준을 적용한 결과를 **섹션별 분류표**로 남기게 했다.
표의 각 행은 원본 섹션 하나를 `stay` / `merge → X` / `design/<file>.md` / `delete-and-link` / `ADR` /
`drop` 중 하나에 귀속시킨다. Plan 문서가 스스로 적었듯 **"분류가 리뷰 대상이고 diff는 그 결과"** 다.

**그런데 표와 산출물이 일치하는지 확인하는 것은 사람의 눈뿐이다. 그리고 실제로 어긋났다.**

`RULE-013` WU-B에서 3라운드 심사가 잡아낸 두 건 — 둘 다 기계 검사 하나면 자동으로 걸렸을 것들이다:

1. **실행되지 않은 disposition.** §23 행이 "`agent-framework`의 runner/manager 계약 재서술 →
   `delete-and-link`"라고 적혀 있었는데, 실제 diff는 그 내용을 `design/subagent-wiring.md`로 **옮겼다**.
   `delete-and-link`와 `design`은 다른 처분이고, 특히 이 경우 소유 패키지의 계약을 말바꿈한 사본을 새
   파일명 아래 **보존**하는 결과였다 — 같은 문서가 Pilot 2에 대해 하지 말라고 명시한 바로 그것.
   두 라운드 동안 아무 게이트도 이것을 잡지 못했다.
2. **한 내용에 처분 두 개.** §11 split 표는 `Variable Substitution`을 `design/command-registry.md`로
   보내라 하고, 같은 문서의 부록은 같은 내용을 `Extension Points`로 되돌리라 했다. 표가 스스로
   모순인 상태로 커밋됐다.

`RULE-013`의 TC-07("분류표 완결성")은 **모든 원본 섹션이 어딘가에 귀속됐는지**는 요구하지만
**귀속된 곳에 실제로 있는지**는 요구하지 않는다. 완결성은 있고 정합성은 없다.

## Prior Art Research

Waived: 배치 기준의 선행 조사는 `RULE-013`의 `## Prior Art Research`가 이미 수행했고, 이 항목은 새
기준을 세우지 않는다. 저장소 내 선례가 근거로 더 적절하다 —
`scripts/harness/scan-doc-folder-status-agreement.mjs`가 규칙 문서의 status↔폴더 표를 **파싱해서**
기준으로 삼고 트리 전체를 검사한다(표를 복사하지 않는다). 같은 형태를 분류표에 적용하면 된다.

## Solution (초안 방향)

분류표를 **파싱해서** 각 행의 처분이 실제로 이행됐는지 검사하는 스캔.

| 처분               | 기계 단정                                                         |
| ------------------ | ----------------------------------------------------------------- |
| `stay`             | 해당 `##` 섹션이 SPEC에 여전히 존재                               |
| `merge → X`        | 그 내용이 SPEC의 `## X` 아래에 있다                               |
| `design/<file>.md` | 그 파일이 존재하고 해당 내용을 담고 있다                          |
| `delete-and-link`  | 그 내용이 **어느 목적지에도 없고**, 소유 문서로의 링크가 존재한다 |
| `ADR`              | `.design/decisions/`에 대응 문서가 있다                           |
| `drop`             | 어디에도 없고, 대응 태스크가 제기돼 있다                          |

같은 원본 섹션에 처분이 둘 이상 붙으면 그 자체가 finding이다(위 결함 2).

`verify-doc-split-preservation.mjs`의 `deletedAndLinkedTo` 검증이 이미 `delete-and-link` 행의 일부를
기계로 잡는다 — 그 조각을 확장하는 형태가 자연스럽다.

## Completion Criteria (초안)

- [ ] TC-01: 분류표를 파싱해 처분별로 단정하는 스캔이 존재하고 `pnpm harness:scan`에 등록됨
- [ ] TC-02: 픽스처로 위 결함 2건(미실행 disposition, 중복 처분)을 각각 red로 재현
- [ ] TC-03: 표를 읽지 못하면 **fail-closed**
- [ ] TC-04: `::examined::`로 검사한 행 수를 선언 (HARNESS-057)
- [ ] TC-05: `RULE-013` 부록 **Pilot 1의 34개 행**에 대해 green. **62개 전수가 아니다** — Pilot 2의
      28개 행은 의도적으로 미실행이고(`DOCS-025`로 이관) 전수를 요구하면 통과 자체가 불가능하다.
      대안으로 표가 미실행 행을 `planned`로 표시하게 하고 전수를 요구하는 형태도 가능하나, 그러면
      표 형식을 먼저 바꿔야 한다. **통과할 수 없는 수용 기준을 싣는 것이 이 백로그 계열이 막으려는
      것이므로**, 스코프를 좁히는 쪽을 택한다

## Evidence Log

- **2026-08-16 — 제기.** `RULE-013` WU-B 3라운드 심사가 권고 4번으로 명시("mechanize table→artifact
  conformance as the successor to TC-07"). WU-B에 접지 않고 후속으로 분리한 이유: WU-B는 이미 10파일
  +1,693 / −1,101(`git show --stat 690c1e964`)로 PR Unit Rule 상한을 넘었고, 이 스캔은 그 자체로 픽스처와 fail-closed 설계가 필요한
  독립 작업이다. **드롭이 아니라 명명된 후속임을 심사자가 요구했고 그에 따라 파일로 남긴다.**
