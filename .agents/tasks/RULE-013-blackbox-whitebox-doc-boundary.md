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

- [ ] **T-20** (TC-07) `agent-framework/docs/SPEC.md` L668–2593을 `docs/design/` 하위 2–3개 주제
      문서로 분할 (순수 이동)
- [ ] **T-21** (TC-06, TC-11) `agent-cli/docs/SPEC.md`의 whitebox 섹션을 `docs/design/`로 이동.
      **`Keyboard Controls`·`TUI Visual Grammar`는 SPEC 잔류**하되 Phase 1b의
      `## User-Facing Contract` 아래로 재배치
- [ ] **T-22** (TC-08, TC-09) 각 design doc이 MUST 5섹션(Context & Goal / Constraints / Internal
      Structure / Key Flows / Test Approach)을 충족
- [ ] **T-23** (TC-10) SPEC↔design 양방향 링크
- [ ] **T-24** (TC-12) 전체 유출량 회귀 확인 — T-18이 확정한 기준 대비
- [ ] **T-25** (TC-05) 회수 후 유출 스캔 exit 0

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
