---
status: draft
type: INFRA
tags: [docs, infra]
---

# DOCS-025: `agent-framework/docs/SPEC.md`는 문서 두 개가 이어붙은 상태다

## Problem

`packages/agent-framework/docs/SPEC.md`(2,649줄, `##` 섹션 28개)는 **한 패키지를 두 번 서술하는 문서 두
벌이 물리적으로 이어붙어 있다.**

```
L3   ## Scope … L694  ## Class Contract Registry 끝     ← 문서 1: 표준 섹션 SPEC, L3–694 (692줄)
L695 ## Overview                                        ← 문서 2 시작, 1,955줄
     "Robota SDK is a programming SDK built by assembling existing Robota packages."
```

`## Overview`(L695)는 `## Scope`(L3)의 재작성이고, 그 뒤로 `## Core Principles` · `## Architecture` ·
`## Feature Details` · `## Public API`가 이어진다.

**문서가 이 사실을 스스로 적고 있다:**

- `## Architecture Overview`(L63) 본문 — _"See the 'Architecture' section below for the full package
  dependency chain and feature layout."_ 그 `## Architecture`는 L716에 있다.
- `## Public API Surface`(L161, 익스포트 표)와 `## Public API`(L1342, 익스포트별 서술 + 시그니처)는
  같은 주제의 두 판본이며 1,181줄 떨어져 있다.

**두 판본은 이미 서로, 그리고 소유 패키지와 어긋나 있다.** `## Feature Details`(L877, 465줄)는
`agent-framework`가 소유하지 않는 세션·권한·훅·툴·샌드박스 시스템을 서술하는데, `agent-core`의 SPEC이
훅 이벤트 16개를 열거하는 자리에서 이 사본은 6개만 적는다. 드리프트가 이미 발생했고, 문서가 둘이면
다음 드리프트도 조용히 일어난다.

### 왜 `RULE-013`이 아닌 별건인가

`RULE-013`이 세운 consumer-impact 기준은 이 문서의 모든 섹션을 정확히 분류한다 — 실제로
[`RULE-013`](../done/RULE-013-blackbox-whitebox-doc-boundary.md) 부록의 Pilot 2 표가 28개 전수를 분류해 두었다. 그러나 **분류는 이 결함을 고치지 못한다.** 고치려면 같은 대상을 서술하는
두 벌을 섹션 단위로 대조해 **어느 쪽이 현행인지 판정**해야 하고, 그것은 배치 기준이 답하지 않는 질문이다.
배치 기준이 이 결함을 만들지도 않았다.

규모도 다르다. 665줄을 160줄에 중복 제거해 접고, ≈350줄을 delete-and-link하고, ≈600줄을 design으로
빼는 작업은 2,649줄 SPEC의 재작성이다. `backlog-execution.md` > PR Unit Rule의 소프트 상한(~600 changed
lines)의 네 배를 넘는다. `RULE-013` WU-B는 이 때문에 `agent-cli` 파일럿 한 건으로 좁혔다.

## Prior Art Research

Waived: 이 항목이 적용하는 배치 기준의 선행 조사는 `RULE-013`의 `## Prior Art Research`에서
이미 수행됐다 — Parnas & Clements SCR/A-7E의 Module Guide / MIS / Module Internal Design 3분할,
IEEE 1016-2009의 Interface viewpoint 분리, ISO/IEC/IEEE 29148, arc42 §5 blackbox/whitebox와 selectivity.
`DOCS-025`는 새 기준을 세우지 않고 그 기준을 한 문서에 적용해 **중복 서술 두 벌을 대조·병합**한다.
문서 병합에는 별도의 외부 선행 사례가 없고, 판정 근거는 저장소의 실제 코드다(위 Solution 1단계).

## Solution (초안 방향)

Pilot 2 분류표를 출발점으로 삼되, **선결 단계는 대조다.**

1. **중복 쌍 판정.** 겹치는 섹션 쌍 — `Scope`↔`Overview`, `Architecture Overview`↔`Architecture`,
   `Public API Surface`↔`Public API`, `Boundaries`↔`Core Principles`/`Import Rules` — 마다 어느 서술이
   현행인지 **코드로 검증**해 판정한다. 문서끼리 비교해서는 결정할 수 없다. 어긋나는 항목은 목록으로
   남긴다(그 자체가 이 항목의 산출물 중 하나다).
2. **접기.** 판정된 현행 내용을 표준 섹션 한 곳으로 접는다. `Public API`의 시그니처·이벤트·페이로드는
   `Public API Surface`로 흡수된다 — 계약이므로 design으로 나가지 않는다.
3. **소유권 반환.** `## Feature Details` 중 다른 패키지가 소유한 서술은 delete-and-link한다. design으로
   옮기면 드리프트를 새 파일명 아래 보존하는 것뿐이다.
4. **whitebox 추출.** 남은 내부 실현(`Client–SDK–Session Relationship`, `Feature Layout`,
   `WorktreeSubagentRunner`, `AgentDefinitionLoader`, 프롬프트 조립, wake dedup/eviction, 훅 배선)을
   `packages/agent-framework/docs/design/`으로 옮긴다.
5. **`## Design Decision Records`(L2040)** → `.design/decisions/` ADR.
6. **`## Unconnected Packages (Future Integration Targets)`(L2643)** → 로드맵이므로 SPEC에서 제거하고
   태스크로 제기한다.

**Work unit 분할이 필요하다.** 최소한 1–2(대조와 접기)와 3–6(반환·추출)은 별개 PR이어야 한다. 1–2는
판정이 실려 있어 리뷰가 무겁고, 3–6은 기계적 이동에 가깝다.

## Completion Criteria (초안)

- [ ] TC-01: `## Overview` · `## Core Principles` · `## Public API` · `## Feature Details`가 SPEC에
      존재하지 않는다 (`rg -c '^## (Overview|Core Principles|Public API|Feature Details)$'` → 0)
- [ ] TC-02: 잔류 `##` 헤딩이 전부 표준 섹션으로 정규화된다 (`isStandardSpecSection()` 단정)
- [ ] TC-03: 중복 쌍 판정 기록 — 어긋난 항목마다 어느 쪽을 채택했고 무엇으로 검증했는지 남는다
- [ ] TC-04: 훅 이벤트 서술이 `agent-core` SPEC 링크로 대체됨 (사본 없음)
- [ ] TC-05: `node scripts/harness/check-design-doc-completeness.mjs` → exit 0
- [ ] TC-06: `check-spec-whitebox-leakage.mjs`에서 `agent-framework`가 임계 아래로 내려간다
- [ ] TC-07: `pnpm harness:scan` → exit 0

## Evidence Log

- **2026-08-16 — 제기.** `RULE-013` WU-B 구현 착수 중 섹션 분류에서 발견. `RULE-013`의 스코프를
  `agent-cli` 파일럿으로 좁히면서 분리 제기했다. 실측: 2,649줄 / 28섹션, 이음매 L695,
  `Public API Surface` 160줄 ↔ `Public API` 665줄, `Feature Details` 465줄, 훅 이벤트 6 vs
  `agent-core` 16. 분류 근거는
  [`RULE-013`](../done/RULE-013-blackbox-whitebox-doc-boundary.md) 부록 Pilot 2.
