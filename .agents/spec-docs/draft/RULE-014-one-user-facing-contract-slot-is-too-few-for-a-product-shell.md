---
status: draft
type: RULE
tags: [docs, cli]
---

# RULE-014: 제품 셸에는 `User-Facing Contract` 슬롯 하나로 부족하다

## Problem

`RULE-013`이 표준 SPEC 섹션에 선택 슬롯 `User-Facing Contract`(O6)를 추가하고, WU-B가 `agent-cli`에
처음 적용했다. 결과는 **1,017줄 · 4단 헤딩짜리 단일 섹션**이다 — 문서 전체의 58%(1,017 / 1,744).

그 안에 CLI 사용법, 첫 실행 설정, 슬래시 명령, 스킬 호출, 키 바인딩, 실행 워크스페이스 스위처,
TUI 시각 문법, StatusBar, 툴 호출 표시, 툴 실행 표시, 출력 상한, 컨텍스트 관리, 메모리, 편집
체크포인트, 플러그인 TUI, 배경 작업 제어, 투명성 경계 4종, 알려진 제약이 함께 들어 있다.

**이것은 섹션이 아니라 컨테이너다.** 파일럿은 `agent-cli`를 "whitebox 사이에서 계약을 찾을 수 없음"
에서 "범주로는 찾히나 그 안에서 길을 잃음"으로 옮겼다. 진전이지 종착점은 아니다.

근본 원인: 표준 섹션 목록은 **라이브러리 패키지**를 전제로 설계됐다. 라이브러리의 consumer는 호출
코드이고 그 계약은 `Public API Surface` 하나로 충분히 나뉜다. **제품 셸은 계약이 곧 UX**여서
표면 자체가 여러 축을 갖는다 — 무엇을 입력하는가, 무엇이 화면에 나오는가, 무엇이 디스크에 남는가.
한 축을 위해 만든 슬롯 하나에 세 축을 밀어 넣으면 컨테이너가 된다.

## Prior Art Research

Waived: 문서 타입 분할의 선행 조사는 `RULE-013`의 `## Prior Art Research`(Parnas SCR/A-7E,
IEEE 1016-2009 viewpoints, arc42 §5 selectivity)가 이미 수행했다. 특히 IEEE 1016의 **viewpoint 분리**
가 이 항목이 적용할 개념이다 — 하나의 설계 대상을 서로 다른 관심사별 뷰로 나누어 기술하고, 각 뷰가
독립적으로 완결되게 한다. `User-Facing Contract`를 축별로 쪼개는 것은 그 개념의 직접 적용이며,
새로운 외부 사례가 필요하지 않다.

## Solution (초안 방향)

두 갈래 중 하나. 결정 전 `agent-cli` 실물로 검증한다.

- **A — 슬롯 분할.** `Invocation Surface`(사용자가 입력하는 것: 플래그, 슬래시 명령, 키 바인딩,
  스킬 호출)와 `Terminal Display Contract`(사용자가 보는 것: 시각 문법, StatusBar, 툴 표시, 출력 상한)로
  나눈다. 첫 실행/설정 흐름은 `Configuration`이 이미 받는다.
- **B — 하위 구조 규정.** 슬롯은 하나로 두되 `spec-writing-standard`가 `###` 층의 필수 구성을 규정하고,
  섹션 크기 상한을 두어 컨테이너화를 기계로 막는다.

A가 표준 섹션 목록을 늘리는 대신 각 슬롯의 의미를 선명하게 하고, B는 목록을 건드리지 않는 대신
검사를 하나 늘린다. **A를 우선 검토한다** — "찾을 수 있는가"는 슬롯 이름이 답하는 질문이지 크기
상한이 답하는 질문이 아니다.

어느 쪽이든 파급 범위가 있다: 표준 섹션 목록은 `spec-writing-standard/SKILL.md`가 SSOT이고
`scripts/harness/spec-sections.mjs`가 그것을 파싱하며, `check-spec-whitebox-leakage.mjs`와
`cleanup-drift.mjs`가 그 결과를 쓴다. 슬롯을 늘리면 넷 다 자동으로 따라온다(그게 `RULE-013` WU-A가
SSOT를 만든 이유다).

## Completion Criteria (초안)

- [ ] TC-01: A/B 중 하나가 근거와 함께 선택되고 `spec-writing-standard/SKILL.md`에 반영됨
- [ ] TC-02: `spec-sections.mjs` 파서가 변경된 목록을 자동으로 반영(하드코딩 없음)
- [ ] TC-03: `agent-cli`의 `User-Facing Contract`가 해소되고, 어떤 단일 `##` 섹션도 문서의 절반을
      넘지 않는다
- [ ] TC-04: `pnpm harness:scan` exit 0

## Evidence Log

- **2026-08-16 — 제기.** `RULE-013` WU-B 3라운드 심사가 "Not blocking, file separately"로 명시.
  실측: `packages/agent-cli/docs/SPEC.md`의 `## User-Facing Contract` 1,017줄 / 전체 1,744줄 = 58%,
  헤딩 4단. WU-B에 접지 않은 이유는 이것이 파일럿의 결함이 아니라 **표준 섹션 목록의 결함**이고,
  목록을 바꾸는 것은 `RULE-013` WU-A가 확정한 계약을 다시 여는 일이기 때문이다.
