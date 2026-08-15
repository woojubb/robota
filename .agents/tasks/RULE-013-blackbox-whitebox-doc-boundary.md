---
title: 'RULE-013: SPEC/design 배치 기준과 whitebox 유출 회수 — 계약·강제(WU-A) 및 파일럿 추출(WU-B)'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: .agents/rules, .agents/skills, .agents/templates, .agents/specs, scripts/harness, packages/agent-cli/docs, packages/agent-framework/docs
depends_on: []
---

# RULE-013: SPEC/design 배치 기준과 whitebox 유출 회수

Plan: [`.agents/spec-docs/todo/RULE-013-blackbox-whitebox-doc-boundary.md`](../spec-docs/active/RULE-013-blackbox-whitebox-doc-boundary.md)
(status `approved`; GATE-WRITE ×2 · GATE-APPROVAL PASS)

## Problem

`RULE-009`가 design/LLD 타입을 정의했지만 **어떤 사실이 `SPEC.md`에 가고 어떤 사실이 `docs/design/`에
가는지 판정하는 기준이 없다.** 그 결과 whitebox 내용이 blackbox 계약 문서로 흘러들었고, design 문서
실물은 0개다. 상세·측정치·근거는 위 spec-doc이 소유한다.

## Work units

`backlog-execution.md` > PR Unit Rule에 따라 둘로 나눈다. **WU-A PR 병합 후에 WU-B를 시작한다**
(One-Backlog-At-A-Time). 각 work unit은 자체 recommendation gate를 가진다 — WU-A는
`proposal-reviewer` 심사를 거쳤다.

---

## WU-A — 계약과 강제 (Phase 1 · 1b · 3 · 4)

### Phase 1 — 배치 기준 명문화

- [x] **T-01** (TC-01) `design-doc-authoring/SKILL.md`에 배치 기준 섹션 신설 — 소비자 파급 테스트 + 경계 사례 표. **최종 사용자 대상 계약 행을 반드시 포함**(키 바인딩·시각 문법은 whitebox가
      아니라 사람이 소비자인 blackbox 계약)
- [x] **T-02** (TC-02) `spec-writing-standard/SKILL.md`와 `spec-workflow.md`에서 배치 기준으로
      **링크만** 건다. 기준 본문 복사 금지 (Non-Duplication)

### Phase 1b — `User-Facing Contract` 슬롯 + 표 정정 (Phase 3의 선결 조건)

- [x] **T-03** (TC-14) `spec-writing-standard/SKILL.md` 선택 섹션에 `User-Facing Contract` 추가
- [x] **T-04** (TC-14) `.agents/templates/spec-template.md`에 대응 섹션 반영
- [x] **T-05** (TC-15 선결) 같은 스킬의 "Required Sections Reference" 표에 **선택 섹션을 열거**한다.
      현재 필수 9만 있고 선택 5는 Mode A 절차문(L46-51)에만 있어 발견 불가 — GATE-WRITE 가디언이
      실제로 "열거된 곳이 없다"고 결론냈다. Phase 3이 이 표를 **파싱**하므로 이 항목은 정정이 아니라
      **선결 조건**이다

### Phase 3 — 강제 (스캔·SSOT·테스트)

- [x] **T-06** (TC-15) 표준 섹션 SSOT를 **문서 쪽에 둔다** — `spec-writing-standard/SKILL.md`의
      Required Sections Reference 표(+ Phase 1b 선택 표)를 **파싱**하고, 읽기 실패·빈 표에는
      **fail-closed**. `scan-doc-folder-status-agreement.mjs` 선례를 그대로 따른다.
      `shared.mjs`에 하드코딩 배열을 두지 않는다.
      **필수/선택 두 집합을 구별 가능하게 반환해야 한다** — `cleanup-drift`는 *필수만*의 존재를
      단정하는데 유출 지표는 *필수 ∪ 선택*을 덮는다. 하나로 뭉치면 `## Configuration`이 있다는 이유로
      `Class Contract Registry` 누락 보고가 사라진다. 표를 각각 앵커링하고, TC-15의 집합 동등성
      단정은 **필수 표에 한정**한다
- [x] **T-07** (TC-15) `cleanup-drift.mjs`의 자체 8개 복사본 제거 → 공유 matcher 소비.
      누락된 `Class Contract Registry`가 이 과정에서 교정된다
- [x] **T-08** (TC-04) **헤딩 normalizer/matcher** 구현 — `normalizeSpecHeading()` +
      `isStandardSpecSection()`. 서수 접두사(`^\d+[.)]\s*`), 대소문자, 후행 괄호를 흡수한다.
      공유 단위는 이름 배열이 아니라 **matcher**다
- [x] **T-09** (TC-04) `check-spec-whitebox-leakage.mjs` 신규 (**advisory**) —
      `listWorkspacePackageDirs()` 소비(신규 글롭 금지). **기본 출력은 임계 이상 finding +
      `::examined::` 한 줄뿐**이고, 87행 순위표는 플래그 또는 `--report-file` 뒤에 둔다
      (`harness:review`·`harness:run-context` 관례) — 매 실행마다 서사를 뿜는 가드는 거부까지 함께
      스크롤된다(property 4). 기준을 읽지 못하면 **exit 1**(Silence is not success)
- [x] **T-10** (TC-04) 단위 테스트 — 회수 전 스냅샷 고정 픽스처. **정정된 기대값**을 쓰고
      깨진 측정(203/203, 210/210)을 동결하지 않는다. 진짜 변형 케이스를 별도로 포함
- [x] **T-11** (TC-16) 스캔이 `::examined::`로 검사 파일 수를 보고하고, `--all` 출력에
      `packages/dag-nodes/` 항목이 20건 나타난다. **총계는 단정하지 않는다** — 손 집계 87은
      `packages/dag-nodes/docs/SPEC.md`(package.json 없는 컨테이너)를 잘못 포함한 값이었고,
      SSOT 열거기 기준은 86이다. 막을 회귀는 중첩 그룹 누락이지 특정 총계가 아니다
- [x] **T-12** (TC-13) `check-design-doc-completeness.mjs`에 SPEC→design 역방향 링크 warning 추가
- [x] **T-13** (TC-13) `run-all-scans.mjs`에 신규 스캔 등록

### Phase 4 — mandate 범위 조정 + 모순 스윕 (범위 확대, 2026-08-16 승인)

- [x] **T-14** (TC-03) `spec-workflow.md` Live Spec Policy mandate 행을
      `New or changed externally observable behavior or semantics`로 좁히고 내부 동작 변경의
      design doc 라우팅 문장 추가. 나머지 6행 불변
- [x] **T-15** (TC-03) **모순 스윕** — 같은 파일 § Document Authority and Content Placement의
      Design documents 행을 `packages/*/docs/design/` + 횡단 `.agents/specs/`로 정정. SPEC↔design
      내용 분할은 배치 기준으로 **링크 위임**(복사 금지). 현재 그 행은 `.design/**`를 가리켜
      `design-doc-authoring/SKILL.md:35`("NOT `.design/`")와 정면 모순이고, blocking 스캔
      `document-authority`로 기계화돼 있다
- [x] **T-16** (TC-03) `check-document-authority.mjs::isDesignDoc()`이 `packages/*/docs/design/`를
      인식하도록 확장. 스윕 결과를 Evidence Log에 기록 (`learning-loop.md`: "A MUST is not in force
      while another document permits its negation")
- [x] **T-17** (TC-03) `isDesignDoc()`에서 **`.design/decisions/` 제외** — 같은 함수를 두 번 건드리지
      않도록 T-16과 함께. 근거: 타이포노미가 그 경로를 ADR 위치로 선언했고 RULE-010의 `adr` 게이트가
      이미 소유한다("one finding per defect, reported by its owner"). 더 중요한 건 **현재 그 경로에서
      finding이 뜨면 해소가 구조적으로 불가능**하다는 것 — `hasMatchingOwnerDocument()`의 탈출구가
      `^(packages|apps)/([^/]+)/` 스코프에서 파생되는데 `.design/**`는 그 스코프를 만들 수 없다.
      `ADR-002`는 헤딩 하나 이름만 바뀌면 해소 불가 블록에 걸린다
- [x] **T-18** (TC-05, TC-12) **기준선 재도출을 WU-A 안에서 수행** — 파서가 착지한 직후 `## Problem`의
      인용 수치를 갱신한다. `## Problem`은 GATE-APPROVAL 보호 대상이 아니다. 심사자 실측:
      정규화 시 **6,774 / 17,139 = 39.5%**, `apps/www` 210→9, `agent-transport` 203→6이며 임계
      `≥300 AND ≥40%`의 적발 집합은 **불변**(여전히 `agent-framework`·`agent-cli` 2건). TC-12 임계는
      바꿀 필요 없다 — 잔여 ≈3,319 = 24.3%로 ≤3,600·≤30% 안이고 여유가 늘어난다. **인용 수치만** 이동
- [x] **T-19** (TC-11, TC-13) `pnpm harness:scan`이 **깨끗한 트리 기준선과 동일**(사전 존재하는
      `dist` 1건만 실패 — `pnpm build` 미실행 때문이며 스태시 대조로 확인), `pnpm harness:cleanup`
      exit 0, 신규 단위 테스트 green. 이 트리에서 `harness:scan` exit 0은 성립하지 않으므로
      초안의 그 단정은 폐기한다

---

## WU-B — 파일럿 추출 (Phase 2) — WU-A 병합 후 착수

- [x] **T-20** (TC-07) 두 파일럿 **62개 `##` 섹션 전수 분류표** 작성 — `agent-cli` 34 +
      `agent-framework` 28, 각 섹션마다 consumer-impact 답 1줄과 stay / merge / design /
      delete-and-link / ADR / drop 귀속. Plan 문서의 `## Appendix — WU-B per-section classification`.
      **초안의 "L668–2593을 2–3개 문서로 분할"은 폐기했다** — 그 줄 범위는 이제 L695–2649이고,
      더 중요하게는 `agent-framework/docs/SPEC.md`가 **문서 두 벌이 이어붙은 상태**임이 분류 중
      확인됐다(`## Overview` L695부터 재시작, `Public API Surface` L161 ↔ `Public API` L1342).
      순수 이동으로 풀리는 문제가 아니라 두 서술을 대조해 현행을 판정해야 하는 별건이라 `DOCS-025`로
      분리 제기했다. 분류표는 그 항목의 출발 분석으로 넘긴다
- [x] **T-21** (TC-06, TC-11) `agent-cli/docs/SPEC.md` 재구성 — 34개 `##` 섹션을 표준 15슬롯으로
      정규화, 비표준 헤딩 **0개**(`isStandardSpecSection()` 단정). `Keyboard Controls` ·
      `TUI Visual Grammar` · `StatusBar Display` · `Slash Commands` · `CLI Usage` · `First-Run Setup`
      등 최종 사용자 계약은 **SPEC 잔류**, `## User-Facing Contract` 아래로 재배치
- [x] **T-22** (TC-08, TC-09) design doc **6건** 신설(`composition` · `session-ownership` ·
      `command-registry` · `internal-structure` · `message-architecture` · `subagent-wiring`), 전부
      MUST 5섹션 충족 — `check-design-doc-completeness.mjs` exit 0, 경고 0
- [x] **T-23** (TC-10) SPEC↔design 양방향 링크 — SPEC에 `docs/design/` 7회, 6개 design doc 전부
      `../SPEC.md` 역참조
- [x] **T-24** (TC-12) 전체 유출량 관측 — 6,675줄/38.4% → **4,967줄/28.9%**(-1,708줄, -9.5pp),
      임계 초과 2건 → **1건**(`agent-framework`, `DOCS-025`가 회수)
- [x] **T-25** (TC-05) 회수량과 무손실을 직접 단정 — `verify-doc-split-preservation.mjs` exit 0
      (허용 11건 명시: 해체·개명된 헤딩 제목 9 + 줄바꿈이 바뀐 문장 2), design 본문 **297줄**(기준 ≥200).
      **초안의 "표준 섹션 밖 ≤150줄"은 폐기했다** — 스캔이 `##`만 마크하므로 강등으로 만족된다
      (`HARNESS-052` G8). 세 번째 정정이며 이번엔 임계가 아니라 대상을 바꿨다
- [x] **T-26** (Round 2) 계약 3건 SPEC 복귀 + whitebox 5건 추출 + 분류표 부록에 8건 등재

**절차:** 추출은 Mode C drift recovery와 동일하게 **전용 PR, 기능 작업과 혼합 금지**.

---

## Test Plan

검증은 spec-doc의 `## Test Plan`(TC-01~TC-16)이 소유하며 여기서 복제하지 않는다. 이 파일은 TC ↔ 태스크
귀속만 기록한다 — 위 각 태스크의 괄호가 그 매핑이다.

실행 관점의 요약: **WU-A**는 `rg` 패턴 기반 command-form 검사(배치 기준·링크·mandate 문구·슬롯 존재),
신규 스캔의 단위 테스트(임계 정확도 + 정규화 + 오탐 픽스처), 그리고 `pnpm harness:scan` exit 0으로
판정한다. 특히 **T-10의 red-prove가 필수**다 — 회수 전 상태에서 스캔이 `agent-framework`·`agent-cli`
2건을 실제로 잡지 못하면 이 스캔 자체가 vacuous green이 되며, 그것은 이 백로그가 없애려는 결함과 같은
부류다. **WU-B**는 스캔이 green으로 전환되는 것과 SPEC 크기 회귀(각 700줄 이하), design doc 실물 존재,
양방향 링크로 판정한다. `manual` 검증 항목은 없다.

## Recommendation Gate — WU-A

**REVIEW VERDICT: ENDORSE** | 2026-08-16 | `proposal-reviewer` (revision 1)

1차 심사는 `REVISE`였고 네 findings(헤딩 파서 오진단 · SSOT를 코드가 아닌 문서에서 파생 ·
`listWorkspacePackageDirs()` 소비 · Document Authority 모순 스윕)를 전부 접어 넣은 뒤 재심사에서
`ENDORSE`. 재심사가 추가로 확정한 세 항목(필수/선택 집합 분리, 순위표를 플래그 뒤로, 기준선 갱신을
WU-A 안에서)과 `.design/decisions/` 제외 판단은 위 태스크에 반영돼 있다.
`backlog-execution.md` > Recommendation Gate("The verdict must be recorded")에 따른 기록이다.

## Notes

- TC-12 임계는 이미 두 번 정정됐고(산술 오류 → 글롭 누락) 헤딩 파서 정정으로 세 번째 재산출이
  필요하다. 집계 기준(필수 9 + 선택 6, 정규화된 헤딩 매칭)을 T-06의 SSOT에 고정한 뒤 산출한다.
- **별도 제기 대상(범위 밖, 확정)**: `hasMatchingOwnerDocument()`의 탈출구가
  `^(packages|apps)/([^/]+)/` 스코프에서 파생되어 **패키지 스코프가 없는 횡단 design 문서에서는
  구조적으로 도달 불가**하다. "횡단 문서의 owner document란 무엇인가"는 RULE-013가 답하지 않는 별개
  설계 문제라 접지 않는다. 다만 WU-A가 노출을 줄인다 — `packages/*/docs/design/`가 인식되면 이 검사가
  가장 필요한 문서들이 비로소 패키지 스코프를 갖게 되어 탈출구가 작동한다.
- **PR에 적을 부수 효과**: `DESIGN_CONTRACT_HEADINGS`에 `## Public API`가 있으므로,
  `packages/*/docs/design/`가 인식되는 순간 `document-authority`가 배치 기준의 **두 번째, blocking
  강제**가 된다 — 공개 계약 내용을 담은 파일럿 design doc은 게이트에서 실패한다. Finding 4를 접는
  비용이 아니라 이득이다.

## Recommendation Gate — WU-B

`backlog-execution.md` > Recommendation Gate. 판정자 `proposal-reviewer`(독립 에이전트), 2라운드.

### Round 1 — `REVIEW VERDICT: REVISE` | 2026-08-16

착수 전 판정. 지적과 처리는 Plan 문서
[`## Evidence Log` > WU-B 구현](../spec-docs/active/RULE-013-blackbox-whitebox-doc-boundary.md)의 표에
기록. 요지: TC-05·TC-12가 개명만으로 통과 가능(스스로 vacuous green), "SPEC ≤700줄" 도달 불가,
P2~P5 전제 오류, **분류표를 먼저 만들라**.

### Round 2 — `REVIEW VERDICT: REVISE` | 2026-08-16

1라운드 접기 결과를 재심사. 세 가지는 clean(범위 축소의 정당성, design doc의 실질성, 내용 무손실 —
심사자가 `comm -23`으로 독립 재현), 두 가지는 불통과. **두 지적 모두 맞았고 직접 검증했다:**

| 지적                                                                                                                                                           | 검증                                                                                                                           | 처리                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-05의 "0"은 허상.** 스캔이 `##`만 마크하므로 `##`→`###` **강등**으로 한 줄도 안 옮기고 0이 된다. 그리고 TC-06은 그 구멍의 봉인이 아니라 **구멍 그 자체**다 | `check-spec-whitebox-leakage.mjs:62`의 `/^##\s+/` 확인. 이 PR이 실제로 비표준 `##` 20개를 `###`로 내려 88.1% → 0.0%를 만들었다 | TC-05를 **지표에서 떼어냈다** — `verify-doc-split-preservation.mjs`(무손실) + design 본문 ≥200줄(회수량). TC-06은 관측 기록으로 강등. 지표 결함은 `HARNESS-052` **G8**로 등재하고 스캔 헤더에 사각지대 명시 |
| **계약 3건이 SPEC 밖으로 나갔다** — 변수 치환 토큰 · `/background` 명령 문법 · `transports` settings 키. 반대로 whitebox 5건이 표준 헤딩 아래 세탁됐다         | `rg`로 3건 부재, 5건 존재 전부 확인                                                                                            | 3건 복귀(`Extension Points` · `User-Facing Contract` · `Configuration`), 5건 추출(`message-architecture` · `composition` · `Test Strategy`). 8건 전부 분류표 부록에 등재                                    |

부수 정정: `design/composition.md`가 존재하지 않는 `check-composition-neutrality.mjs`를 인용
(실제는 `scan-composition-neutrality.mjs`) → 수정. Test Plan의 TC-05/06/07/12/15 행이 폐기된 기준을
가리키고 있던 것 → 갱신.

**심사자가 별건으로 분리하라고 한 것(접지 않음):** `## User-Facing Contract`가 1,017줄 · 4단 헤딩으로
"찾을 수 있으나 그 안에서 길을 잃는" 상태다. 제품 셸에는 슬롯 하나가 부족할 수 있고(`Invocation
Surface` vs `Terminal Display Contract` 분리, 또는 하위 구조 규정), 이는 표준 섹션 목록의 문제이지
이 파일럿의 문제가 아니다. WU-B에 접지 않는다.

### Round 3 — `REVIEW VERDICT: REVISE` | 2026-08-16

세 번째 REVISE. 방향은 승인("leaving the metric instead of re-tuning it is the correct third
correction")이나 세 건이 불통과. **전부 검증하고 접었다:**

| 지적                                                                                                                                          | 검증                                                                                                                                   | 처리                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-05가 실행 불가.** 자리표시자 3개 + `--allowances` 누락 → 문자 그대로 돌리면 exit 1. 허용 11건은 `rg`로 저장소 어디에도 없었다            | `rg -c "allow-lost" .agents/` → **0**. TC-05 문구 확인                                                                                 | ref를 `96728940c`로 고정하고 `--target` 7개를 전부 적은 실행 가능한 명령으로 교체. 허용 목록은 커밋되는 `.split-allowances.json`으로 이관 |
| **§23의 `delete-and-link`가 실행되지 않았다.** 재서술이 `design/subagent-wiring.md`에 그대로 있고, 결론은 "≈20줄 delete-and-link"라 적혀 있다 | 축자 중복은 0이지만 **말바꿈 재서술** 2개 문단 확인. 내 도구가 "유실 0"이라 보고한 것 자체가 delete-and-link가 아무것도 안 했다는 증거 | 두 문단 삭제 + 소유 문서 링크로 대체(실행). 결론 문장은 "2개 문단"으로 정정하고 "≈20줄"이 미실행 추정치였음을 명기                        |
| **§11 split 행이 부록과 모순.** 같은 내용에 처분 두 개                                                                                        | L601 확인                                                                                                                              | 행을 둘로 쪼개 `Skill Execution`만 design으로, `Variable Substitution`/`Shell Command Preprocessing`은 `Extension Points`로 정정          |

**도구 자체도 고쳤다.** `--allow-lost`는 무제한·무기록 탈출구였다 — 미래의 작성자가 삭제된 계약 줄을
화이트리스트에 넣어도 저장소에 흔적이 없다. **이 백로그가 다루는 병의 다른 형태다.** 커밋되는 허용
파일로 바꾸고, 13건 중 11건을 도구가 검증하게 했다: 개명 9건은 대체 문자열이 실제로 목적지에 있는지,
delete-and-link 2건은 소유 문서로의 링크가 실재하는지. 나머지 2건(줄바꿈 재배치)만 서면 사유. 잘못된
허용·사유 없는 허용·없는 허용 파일 전부 red로 재현 확인.

**심사자 권고 4번(표↔산출물 정합 기계화)과 별건 지적은 파일로 제기했다** — 드롭이 아니라 명명된
후속이어야 한다는 요구에 따라: `HARNESS-094`(분류표를 아무도 검사하지 않는다 — 위 두 결함 모두
기계 검사 하나면 자동으로 걸렸을 것), `RULE-014`(`User-Facing Contract` 1,017줄·4단 = 컨테이너,
제품 셸에는 슬롯 하나로 부족).

### Round 4 — `REVIEW VERDICT: REVISE` | 2026-08-16

네 번째. 심사자가 설계는 승인("Architecture-placement verdict: correct", "I would endorse it on design
grounds")했고, 남은 것은 전부 **증거 기록의 결함**이다. 넷 다 검증하고 접었다.

| 지적                                                                                                                                       | 검증                                                                              | 처리                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TC-05 펜스가 깨져 CI가 red.** 닫는 펜스가 여는 펜스보다 8칸 깊어 블록이 닫히지 않았다                                                    | `npx prettier --check` red. 변경 18파일 중 유일                                   | 명령을 체크리스트 밖 `### TC-05 검증 명령`으로 분리. 문서에서 추출 실행 → exit 0                                                                                |
| **allowance entry 12의 소유자가 사유와 모순.** `agent-framework`를 가리키는데 사유는 `agent-command`를 말한다. entry 11의 링크에 얹혀 통과 | 구 SPEC L52 확인 — 그 사실은 **`agent-cli` 자신의 `## Boundaries`에 이미 있었다** | cross-package가 아니라 **in-package 중복**으로 재분류. `deletedAndLinkedTo` 제거하고 근거를 사유에 기록. §23 표 행도 정정                                       |
| **`collectAllowanceFindings`에 구멍 셋**                                                                                                   | 셋 다 재현                                                                        | delete-and-link는 **항목별 링크 1개**를 요구; `survivesAs`가 원본에 이미 있으면 거부; 소유 경로는 `packages/`·`apps/` 앵커 필수. red 픽스처 3건 추가(23 테스트) |
| **TC-12가 추정치를 적고 `[x]` 처리**                                                                                                       | 실측 4,967 / 28.9% vs 기록 ≈6,185 / 35.6% — **1,218줄 차이**                      | 두 끝점을 실행해 표로 기록. Problem §2의 6,654 / 38.5%도 같은 기준으로 정합                                                                                     |

**verify-like-ci는 이미 잡고 있었는데 내가 exit code를 잘못 읽었다.** 백그라운드 실행을
`cmd > log; echo exit=$?; tail log` 형태로 감싸서 알림이 보고한 exit 0은 `tail`의 것이었다. 로그에는
`FAIL — 2 of 12 stage(s) failed: format-check, harness-self-test`가 있었다. **관측된 효과가 아니라
exit code로 성공을 판정하지 말 것** — `.agents/memory/bound-every-wait-and-solve-it-yourself.md`에
적어둔 그대로를 반복했다. `harness-self-test`의 `cleanup-drift`는 재구성으로 `spec-missing-sections`가
47 → 46이 된 것이었고, 지시대로 같은 변경에서 `--write-baseline`으로 재freeze했다.

**후속 파일 정정:** `HARNESS-094`의 TC-05가 62개 행 전수를 요구해 **통과 불가능**했다(Pilot 2의 28개는
의도적 미실행). Pilot 1의 34개로 좁혔다 — 통과할 수 없는 수용 기준을 싣는 것이 이 계열이 막으려는
것이다. `RULE-014`의 60%/58% 불일치도 58%로 통일했다.

### Round 5

4라운드 접기 완료 후 재심사 대기.
