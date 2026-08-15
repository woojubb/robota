---
status: in-progress
type: RULE
tags: [infra, cli]
---

# RULE-013: SPEC / design 문서 경계 — blackbox·whitebox 배치 기준과 whitebox 유출 회수

## Problem

`RULE-009`가 design/LLD 문서 타입을 `defined`로 확립했지만, **어떤 사실이 `SPEC.md`에 가고 어떤 사실이
`docs/design/`에 가는지 판정하는 배치 기준이 없다.** `design-doc-authoring`의 "When is a design doc
required?"는 _존재 여부_ 판단만 다루고 *내용 배치*는 다루지 않는다. 그 결과 whitebox(내부 실현) 내용이
전부 blackbox 계약 문서인 `SPEC.md`로 흘러 들어갔다.

**증상 (전부 재현된 실측값, 2026-08-15 기준):**

1. **design 문서 실물 0개.**

   ```bash
   find packages apps -path "*/docs/design/*" -name "*.md" -not -path "*/node_modules/*" | wc -l   # → 0
   ```

   횡단 위치인 `.agents/specs/*.md` 20개 중 design MUST 5섹션(Context & Goal / Constraints /
   Internal Structure / Key Flows / Test Approach)을 가진 문서도 0개.

2. **그 내용은 `SPEC.md` 안에 있다.** 워크스페이스 패키지 `SPEC.md` **86개** 총 **17,369줄** 중
   표준 섹션(필수 9 + 선택 6) **밖**의 내용이 **6,675줄 = 38.4%**. (이 수치는 TC-12의 기준선과 같은
   실행에서 나온 것이다 — 앞서 적혀 있던 6,654 / 17,270 / 38.5%는 스캔이 완성되기 전 중간 상태의
   출력이라 TC-12와 어긋났고, 4라운드 심사가 그 불일치를 잡았다.)

   이 수치는 WU-A가 만든 `check-spec-whitebox-leakage.mjs`의 `::examined::` 출력이며, 손 집계가
   아니다. 손으로 센 앞선 값 셋은 모두 틀렸다 — 43.5%(최상위 1단 글롭이 중첩 20개 누락),
   41.8%(exact-match 파서가 서수 헤딩 SPEC을 100% 비표준으로 오판), 그리고 파일 수 87(컨테이너
   디렉터리 `packages/dag-nodes/docs/SPEC.md`를 패키지로 오인). **집계를 기계에 넘기는 것이 이
   항목의 요지 중 하나다.**

   집계 범위는 `{packages,apps}/**/docs/SPEC.md`(중첩 포함)다. 최상위 글롭
   `{packages,apps}/*/docs/SPEC.md`만 쓰면 **중첩 워크스페이스 패키지 20개**
   (`packages/dag-nodes/*/docs/SPEC.md`, 1,122줄 중 표준 밖 207줄 = 18.4%)가 통째로 빠져 67개/
   16,017줄/43.5%로 집계된다 — 초안이 실제로 그 오류를 범했고 GATE-WRITE 관측에서 잡혔다.
   Phase 3의 유출 스캔은 반드시 중첩을 포함한 글롭을 써야 한다(아래 실패 모드 8).

   | 파일                                    | 전체 줄 | 표준 밖 줄 |  비율 |
   | --------------------------------------- | ------: | ---------: | ----: |
   | `packages/agent-framework/docs/SPEC.md` |   2,594 |      1,975 | 76.1% |
   | `packages/agent-cli/docs/SPEC.md`       |   1,939 |      1,710 | 88.2% |
   | `packages/agent-core/docs/SPEC.md`      |   1,307 |        427 | 32.7% |
   - `agent-framework/docs/SPEC.md`: 표준 9섹션이 line 667에서 끝나고 **line 668부터 완전히 별개의
     문서가 시작한다** — `## Overview` · `## Core Principles` · `## Architecture`(패키지 의존 체인,
     Client–SDK–Session 관계, Feature Layout) · `## Feature Details`(Session Management, Permission
     System, Hooks, Sandbox, Edit Checkpointing, Reversible Execution 등 30여 개). 1,975줄짜리
     design doc이 SPEC 뒤에 붙어 있는 형태.
   - `agent-cli/docs/SPEC.md`: `## Public API Surface`가 **9줄**(line 989–998). 1,939줄 문서에서
     공개 계약이 **0.5%**다. 나머지는 StatusBar Display, TUI Visual Grammar, Tool Call Display,
     Keyboard Controls(149줄), Plugin Management TUI, Subagent Execution, Message Architecture,
     File Structure 등 whitebox.

3. **결과 A — design 게이트가 vacuous green.** `check-design-doc-completeness.mjs`는 헤더 주석대로
   "no design docs = vacuously clean"이라 대상이 0개인 현재 **구조적으로 항상 통과**한다
   (`HARNESS-052-vacuous-green-sweep`가 쓸어담는 부류).

4. **결과 B — 기계 검증 면적이 0.5%.** `agent-cli`에서 양방향 검증(`check-spec-public-surface`)을
   받는 것은 Public API 표 9줄뿐이고, 나머지 1,930줄은 어떤 검사도 받지 않는다. 앞서 "9섹션 중
   1개만 기계 보장"으로 알려졌던 것이 실제로는 "문서의 0.5%만 보장"이었다.

5. **결과 C — drift가 구조적으로 보장된다.** `spec-workflow.md` > Live Spec Policy의 mandate 행
   `New or changed behavior or semantics → Architecture Overview`가 **내부 리팩터 전부**에 SPEC 동반
   갱신을 요구하게 되어 준수 비용이 폭증한다. 이것이 만성 drift의 원인이다 — `HARNESS-003`(agent-cli
   SPEC이 삭제된 startup 모듈 7개를 몇 주간 참조), `SPEC-MIGRATION-001`(전 패키지 일괄 catch-up).

**재현 조건:** 위 명령 4개(`find`, `wc -l`, `rg -n "^## "`, 표준 섹션 줄 수 집계)를 저장소 루트에서
실행하면 항상 동일하게 관측된다. 특정 브랜치·환경 의존성 없음.

## Prior Art Research

문서 출처만 사용했다(`research.md`: 제품/API/설계 문서·표준 문서 인용, 서드파티 소스코드 불가).
이 조사는 본 세션에서 직접 수행했으며 `prior-art-researcher` 에이전트를 대리 호출하지 않았다 —
아래 4개 출처 모두 http 문서 인용을 갖추므로 GATE-WRITE의 substantiation 요건을 직접 충족한다.

**① Parnas & Clements — SCR / A-7E 모듈 문서 체계 (NRL, 1981–86).**
모듈 문서를 셋으로 분리한다: **Module Guide**(어떤 모듈이 있고 각자 무슨 *비밀*을 숨기는가) /
**Module Interface Specification**(인터페이스의 정확·완전한 기술) / **Module Internal Design**(각
구현의 내부 설계). Module Guide의 명시적 목적은 "설계자와 유지보수자가 **다른 부분의 무관한 세부를
읽지 않고** 자기가 이해해야 할 부분을 식별하게" 하는 것이다.
→ Robota의 `architecture-map` / `SPEC.md` / `docs/design/`와 1:1 대응한다. 우리 3단 구조는 임의
발명이 아니며, **셋째 칸만 비어 있다.** 현재 SPEC.md는 Module Guide의 목적과 정반대 상태다.

- <https://users.ece.utexas.edu/~perry/education/SE-Intro/fakeit.pdf> (A Rational Design Process:
  How and Why to Fake It)
- <https://www.researchgate.net/publication/2814490_The_Modular_Structure_of_Complex_Systems>
- <https://www.osti.gov/biblio/6745063> (SCR/A-7E Extended Computer Module interface specifications)

**② IEEE Std 1016-2009 — Software Design Descriptions.**
SDD를 12개 **design viewpoint**로 조직한다: Context · Composition · Logical · Dependency ·
Information · Patterns use · **Interface** · Structure · Interaction · State dynamics · Algorithm ·
Resource. 핵심은 **Interface viewpoint가 나머지 11개와 나란한 별개 viewpoint**라는 점 — 표준이 이미
"인터페이스 기술"과 "내부 기술"을 서로 다른 view로 분리했고, 어느 viewpoint를 쓸지는 선택 사항이다.
→ Robota 제약: `SPEC.md` = Interface viewpoint, `docs/design/` = Structure/Interaction/State
dynamics/Algorithm/Resource viewpoint. 한 문서에 섞는 것은 표준의 view 분리를 어기는 것.

- <https://standards.ieee.org/ieee/1016/4502/>
- <https://cengproject.cankaya.edu.tr/wp-content/uploads/sites/10/2017/12/SDD-ieee-1016-2009.pdf>
- <https://en.wikipedia.org/wiki/Software_design_description> (viewpoint 12종 목록)

**③ ISO/IEC/IEEE 29148:2018 — Requirements engineering.**
요구/계약 기술은 상위 요구·제약이 강제하지 않는 한 **특정 구현을 함의해서는 안 된다**. 근거는 설계
공간의 과잉 제약 회피다.
→ Robota 제약: 계약 문서에 내부 실현을 적으면 그 내부가 사실상 계약이 되어 교체 자유를 잃는다.
`agent-cli` SPEC의 File Structure·Message Architecture가 정확히 이 상태.

- <https://www.iso.org/standard/72089.html>
- <https://drkasbokar.com/wp-content/uploads/2024/09/29148-2018-ISOIECIEEE.pdf>

**④ arc42 §5 — Building Block View (blackbox / whitebox).**
**blackbox** = 책임 + 인터페이스(내부 은닉). **whitebox** = 내부 분해 + **분해의 동기** + 내부
구성요소의 blackbox 기술. 그리고 이는 **재귀적**이다 — Level 1은 시스템을 whitebox로 열고 내부를
blackbox로 두며, Level 2는 선택된 blackbox를 whitebox로 연다. 중단 기준을 명문화한다:
_"Prefer relevance over completeness. Specify important, surprising, risky, complex or volatile
building blocks. Leave out normal, simple, boring or standardized parts of your system."_
→ Robota 제약: design doc 존재 판단은 이 selectivity 5기준을 그대로 채택한다(전 패키지 강제 금지).

- <https://docs.arc42.org/section-5/>
- <https://docs.arc42.org/section-8/>

**관측된 공통 동작 (4개 출처 전부):** 경계는 "spec vs design"이 아니라 **blackbox vs whitebox**로
그어지며, 판정 기준은 "무엇 vs 어떻게"가 **아니다** — 한 레벨의 *how*가 다음 레벨의 *what*이므로
what/how는 상대적이고 판정 불능이다. 네 출처가 공통으로 제시하는 절대 기준은 **정보 은닉의 secret**,
즉 **변경 파급 범위**다.

**Robota에 적용되는 제약:** 배치 기준을 파급 범위로 정의하되, `agent-cli`의 `Keyboard Controls` ·
`TUI Visual Grammar`처럼 **소비자가 코드가 아니라 최종 사용자**인 계약이 존재한다. 파급 테스트의
"소비자"에 사람을 포함하지 않으면 이 항목들을 design으로 잘못 옮기게 된다.

## Architecture Review

### Affected Scope

**하네스 규칙·스킬 (배치 기준 owner):**

- `.agents/skills/design-doc-authoring/SKILL.md` — 배치 기준(파급 테스트)의 owner 섹션 신설
- `.agents/skills/spec-writing-standard/SKILL.md` — 배치 기준으로의 링크 (복사 금지, 참조만) +
  선택 섹션에 `User-Facing Contract` 신설
- `.agents/templates/spec-template.md` — `User-Facing Contract` 선택 섹션 반영
- `.agents/rules/spec-workflow.md` — Live Spec Policy mandate 행 범위 조정
- `.agents/specs/document-standards/index.md` — Design/LLD 행의 Status note 갱신

**하네스 스크립트:**

- `scripts/harness/shared.mjs` (표준 섹션 목록 SSOT 상수 신설 — 필수 9 + 선택 6)
- `scripts/harness/cleanup-drift.mjs` (자체 8개 복사본 제거 → SSOT import)
- `scripts/harness/check-spec-whitebox-leakage.mjs` (신규)
- `scripts/harness/check-design-doc-completeness.mjs` (SPEC→design 역방향 링크 warning 추가)
- `scripts/harness/run-all-scans.mjs` (신규 스캔 등록)

**파일럿 대상 패키지:**

- `packages/agent-cli/docs/SPEC.md` → `packages/agent-cli/docs/design/*.md`
- `packages/agent-framework/docs/SPEC.md` → `packages/agent-framework/docs/design/*.md`

### Alternatives Considered

**A1. 현상 유지 — `SPEC.md` 단일 문서.**

- Pro: 문서가 하나라 탐색이 단순하고, 이동 PR의 큰 diff가 없다.
- Con: 41.8%(7,172줄)가 영구 미게이트로 남는다. Live Spec mandate가 내부 리팩터에 계속 걸려 drift가
  구조적으로 재발한다(`HARNESS-003` → `SPEC-MIGRATION-001`의 반복). 소비자가 계약을 식별할 수 없다.

**A2. design doc 전 패키지 강제 (존재를 게이트로 승격).**

- Pro: 규칙이 단순하고 커버리지가 100%로 측정된다.
- Con: arc42 selectivity 위반이며 `design-doc-authoring`이 이미 금지한 "box-ticking design doc is
  noise"에 정면 배치된다. 단순 패키지 60여 개에 유령 문서를 만들고, 그 유령들이 즉시 drift한다.

**A3. 배치 기준(파급 테스트) + 유출 감지 advisory 게이트 + 파일럿 2건 _추출_ (선택).**

- Pro: **신규 프로세스가 0개다** — 문서 타입 4종, 템플릿, 스킬, 게이트가 전부 이미 존재하고
  `RULE-009`가 정의를 끝냈다. 파일럿이 신규 집필이 아니라 **이동**이므로 집필 비용이 없고 값이 즉시
  나온다. selectivity를 유지하면서 실제 문제 패키지만 다룬다.
- Con: 문서가 2개면 drift 지점도 2개다. 추출 PR의 diff가 크다.
- 완화: design doc은 계약보다 낮은 정합 기준(구조만 게이트, archivable)을 명시하고, 추출은 Mode C
  drift recovery와 동일하게 **전용 PR·기능 작업 혼합 금지** 규칙을 재사용한다. 순수 이동이므로
  리뷰 부담은 줄 수에 비례하지 않는다.

**A4. per-change spec-doc(`.agents/spec-docs/`)이 design doc을 대신한다.**

- Pro: 이미 259개(done 253) 존재하고 `## Architecture Review`에 내부 구조·대안·결정이 들어 있다.
- Con: per-change 문서는 원리적으로 "지금 이 컴포넌트가 어떻게 동작하는가"에 답할 수 없다 — 델타
  스트림에서 현재 상태를 재구성해야 하며, 그것이 Parnas가 「fake it」에서 문서화의 존재 이유로 든
  바로 그 비용이다. ADR 3개 / design 0개라는 실측이 이 흡수의 결과를 보여준다.

### Decision

**A3을 채택한다.** 근거는 비용 비대칭이다 — A3은 정의·템플릿·스킬·게이트가 모두 존재하는 상태에서
*배치 기준 1개 + advisory 스캔 1개 + 내용 이동*만 추가하므로 신규 프로세스 도입이 0인 반면, A1은
7,172줄의 영구 미게이트와 재발하는 drift를 확정하고, A2는 60여 개 유령 문서를 만들며, A4는 Parnas가
지목한 재구성 비용을 영구화한다.

배치 기준은 **소비자 파급 테스트**로 정의한다 — "이 사실이 바뀌면 이 패키지 _밖의_ 코드 또는
**최종 사용자**가 바뀌어야 하는가?" Yes → `SPEC.md`, No → `docs/design/`. 이는 Prior Art 4개 출처가
공통으로 가리킨 유일한 판정 가능 기준(정보 은닉의 secret)이며, 판정 불능인 "what vs how"를 대체한다.

**Validated recommendation (contract-boundary 변경 — 전 패키지 문서 규약을 바꾸므로 blast radius가
넓다):**

- **Reachability** — 배치 기준의 owner를 `design-doc-authoring`에 두고 `spec-writing-standard`와
  `spec-workflow.md`는 링크만 건다. 세 문서 모두 이미 상호 참조 체계 안에 있어 모든 작성 경로
  (신규 SPEC 작성 / 증분 갱신 / drift recovery / design doc 작성)에서 도달 가능하다. 사실 owner는
  하나이므로 document-standards의 Non-Duplication을 위반하지 않는다.
- **Capability preservation** — 추출은 **삭제가 아니라 이동 + 양방향 링크**다. 현행 SPEC.md가 제공
  하던 정보 중 소실되는 것은 없다. 파급 테스트가 whitebox로 분류하는 항목만 옮기며, 최종 사용자 계약
  (Keyboard Controls, TUI Visual Grammar)은 SPEC에 잔류시킨다 — 이 예외를 기준에 명문화하지 않으면
  능력이 소실되므로 기준의 필수 구성요소로 포함한다.
- **Adversarial pass** — 1차 3건 + 승인 직전 자기검토 4건 + GATE-WRITE 관측 1건, 총 8건. 2차에서 나온 4~7번은 초안의
  실제 결함이었고 승인 전에 본문에 반영했다:
  1. _유출 스캔의 오탐_ — 표준 섹션 판정을 헤딩 이름 매칭으로 하면 `## Architecture`(vs
     `Architecture Overview`) 같은 변형을 쓰는 파일이 100% 유출로 오탐된다. 실측에서
     `packages/agent-transport`(203/203), `apps/www`(210/210)가 이 경우다. → 임계를 **절대 줄 수
     ≥300 AND 비율 ≥40%** 로 AND 결합해 소형·변형 파일을 배제하고, 헤딩 매칭에 별칭을 허용한다.
     이 설정에서 도입 시점에 걸리는 것은 육안 검증을 마친 `agent-framework`(76.1%)·`agent-cli`
     (88.2%) 둘뿐이다. `agent-core`(427줄/32.7%)는 비율 조건에서 탈락하므로 스캔에 넣지 않고
     Phase 1 이후 육안 재검토 대상으로 남긴다 — 검증하지 않은 것을 게이트에 넣지 않는다.
  2. _추출이 drift를 두 배로 만든다_ — design doc을 blocking 게이트로 올리지 않고 구조만 검사
     (현행 `check-design-doc-completeness.mjs` 유지), archivable 수명을 명시해 정합 부담을 계약
     문서보다 낮게 유지한다.
  3. _mandate 축소가 계약 갱신을 느슨하게 만든다_ — mandate 행 조정은 `behavior or semantics`를
     **"외부 관측 가능한"** 으로 좁히는 것뿐이며, 나머지 6개 행(export/type/implements/error/
     lifecycle event/extension point)은 그대로 둔다. 축소된 범위는 design doc이 받는다.
  4. _TC-12의 목표치가 산술적으로 도달 불가였다_ — 초안은 43.5% → 20%를 요구했으나, 파일럿 2건을
     완전 회수해도 잔여는 ≈3,280줄/12,562줄 = **26.1%** 다. 즉 완벽히 수행해도 FAIL하는 기준이었다.
     → TC-12를 절대량 ≤3,400줄 AND 비율 ≤30%로 정정하고 산출 근거를 본문에 남겼다. 20%에 도달하려면
     나머지 65개 패키지가 필요한데 그것은 이 항목의 범위가 아니다.
  5. _표준 9섹션에 최종 사용자 계약의 자리가 없다_ — `Keyboard Controls`·`TUI Visual Grammar`는
     whitebox라서 흘러든 게 아니라 **정당한 blackbox 계약인데 표준 슬롯이 없어서** 비표준 헤딩으로
     존재해 왔다. 슬롯 없이 회수만 하면 유출 스캔이 정당한 계약을 영구히 유출로 집계하고 작성자는
     올바른 이동처가 없다. → Phase 1b(`User-Facing Contract` 선택 섹션)를 신설하고 회수보다 **선행**
     시켰다. 이것이 없었으면 파일럿이 사용자 계약을 design으로 오이동시켰을 가능성이 높다.
  6. _표준 섹션 목록이 3중 복제된다_ — 이 목록은 이미 두 곳에 있고 **이미 어긋나 있다**
     (`spec-writing-standard`는 9개, `cleanup-drift.mjs:13-22`는 8개로 `Class Contract Registry`
     누락). 신규 스캔이 세 번째 복사본을 만들면 드리프트가 확정된다. → `shared.mjs` SSOT 상수로
     통합하고 기존 누락도 교정(TC-15). document-standards의 Non-Duplication 준수.
  7. _Phase 순서가 TC-04와 모순된다_ — TC-04는 회수 _전_ 상태에서 스캔이 정확히 2건을 잡을 것을
     요구하는데 Phase 3(스캔)이 Phase 2(회수) 뒤에 있으면 그 판정을 재현할 수 없다. → 스캔을 회수보다
     먼저 작성하고, 단위 테스트가 회수 전 스냅샷을 고정 픽스처로 박도록 Phase 3에 명시했다.
  8. _집계 글롭이 중첩 워크스페이스 패키지를 통째로 놓친다_ — GATE-WRITE 관측에서 발견됐다. 초안은
     `{packages,apps}/*/docs/SPEC.md`(최상위 1단)로 집계해 `packages/dag-nodes/*/docs/SPEC.md`
     **20개(1,122줄)** 를 빠뜨렸고, 기준선이 67개/16,017줄/43.5%로 잘못 잡혔다(실제
     87개/17,139줄/41.8%). 이는 단순 수치 오류가 아니다 — **같은 글롭으로 스캔을 구현하면 중첩
     패키지 전체가 영구히 유출 감지 밖에 놓인다.** 게다가 1차 정정한 TC-12 임계 ≤3,400줄이 완전
     corpus에서는 3,487 > 3,400으로 다시 미달이 되어 실패 모드 4가 다른 원인으로 재발했다.
     → 기준선을 전수로 정정하고 집계 범위를 Problem에 명시했으며, Phase 3 스캔이 중첩 포함 글롭을
     쓸 것을 요구사항으로 못박고 TC-16으로 회귀를 막았다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 하네스 규칙·문서 5건, 스크립트 5건, 파일럿 패키지 2건
- [x] Sibling scan 완료 — 문서 타입 계약 형제 `RULE-007`(메타폼) · `RULE-008`(architecture-map) ·
      `RULE-009`(design/LLD) · `RULE-010`(ADR) · `RULE-011`(spec-doc frontmatter) 전부 확인. 본 항목은
      기존 타입을 새로 정의하지 않고 `RULE-009`가 남긴 _배치 기준_ 공백만 메우므로 타입 중복 없음
- [x] 대안 최소 2개 검토 완료 — A1~A4 4개
- [x] 결정 근거 문서화 완료 — 파급 테스트 채택 근거, 최종 사용자 계약 예외 및 전용 슬롯, 임계 보수
      설정, SSOT 통합, 실패 모드 8건(자기검토 4건 + GATE-WRITE 관측 1건 포함)

## Fallback & Degradation Declaration

None

## Solution

### Work Unit 분할 (구현 착수 전 선언 — `backlog-execution.md` > PR Unit Rule)

이 백로그는 하나의 PR로 담기에 너무 크다. 소프트 상한은 **~600 changed lines / ~15 files**인데
Phase 2 하나가 약 3,455줄 이동으로 상한을 6배 넘긴다. PR Unit Rule은 이 경우 _"split it into
explicitly named work units **before implementation**; each work unit must have its own
recommendation gate"_ 를 요구하므로, 아래 둘로 나누어 선언한다.

| Work unit            | 범위                       | 예상 규모        | 성격                                                           |
| -------------------- | -------------------------- | ---------------- | -------------------------------------------------------------- |
| **WU-A** 계약과 강제 | Phase 1 · 1b · 3 · 4       | ~11파일, 상한 내 | 규칙 + 그 강제 + 배선 — PR Unit Rule이 "ONE PR"로 명시한 형태  |
| **WU-B** 파일럿 추출 | Phase 2 (`agent-cli` 한정) | ~490줄 이동      | 분류표 + 그 결과인 이동. 수용 기준은 절대 잔여량과 분류 완결성 |

**WU-B는 `agent-cli` 한 건만 다룬다.** 초안은 파일럿 둘을 한 PR에 담았으나, 구현 착수 시 분류에서
`packages/agent-framework/docs/SPEC.md`가 **문서 두 개가 이어붙은 상태**임이 확인됐다 — L3–694가 표준
섹션 SPEC이고 L695의 `## Overview`부터 1,955줄짜리 옛 SPEC이 다시 시작한다. `## Public API Surface`(L161,
표)와 `## Public API`(L1342, 서술)는 같은 주제의 두 판본이고, `## Architecture Overview`(L63) 본문이
_"See the 'Architecture' section below"_ 라고 스스로 적고 있다. 이 결함은 배치 기준이 만든 것도 아니고
배치 기준이 고치는 것도 아니다 — **중복 서술 두 벌을 섹션 단위로 대조해 어느 쪽이 현행인지 판정하는
별개의 작업**이며, 2,649줄 SPEC 재작성 규모다. 소프트 상한의 네 배를 넘고, 경계 기준과 선재 결함이
한 diff에 섞이면 리뷰가 불가능해진다. `DOCS-025`로 분리해 제기하고, WU-B의 분류표를 그 항목의 출발
분석으로 넘긴다. 파일럿의 목적 — 기준이 실물 SPEC에 대해 판정 가능하고 모든 섹션에 방어 가능한 답을
내는지 — 은 `agent-cli` 34개 섹션 전수로 충족된다.

**순서는 WU-A → WU-B로 고정한다.** 두 가지 이유가 같은 방향을 가리킨다:

1. **TC-04가 요구하는 판정이 WU-A 착지 후에만 실물로 성립한다** — TC-04는 스캔이 _회수 전_ 상태에서
   `agent-framework`·`agent-cli` 2건을 잡을 것을 요구한다. WU-A가 먼저 들어가면 이 판정이 픽스처가
   아니라 실제 트리에서 관측된다.
2. **WU-B의 수용 기준이 WU-A의 산출물이다** — 추출의 완료 판정은 WU-A가 만든 스캔이 green으로
   바뀌는 것(TC-05·06·12)이므로, 역순은 성립하지 않는다.

`backlog-execution.md` > One-Backlog-At-A-Time Rule에 따라 **WU-A의 PR이 병합된 뒤에 WU-B를 시작한다.**

**TC ↔ Work unit 귀속:**

- **WU-A**: TC-01 · TC-02 · TC-03 · TC-04 · TC-13 · TC-15 · TC-16
- **WU-B**: TC-05 · TC-06 · TC-07 · TC-08 · TC-09 · TC-10 · TC-11 · TC-12 · **TC-14**

**TC-14는 WU-B에 둔다** — GATE-IMPLEMENT 관측에서 잡혔다. TC-14의 세 번째 단정
(`rg "^## User-Facing Contract" packages/agent-cli/docs/SPEC.md`)은 파일럿 SPEC이 그 섹션을 실제로
쓸 때만 참이 되고 그 작업은 WU-B다. WU-A는 슬롯 **정의**(스킬·템플릿)라는 선결 조건을 제공하지만
TC-14를 닫을 수 없다. 분할은 여전히 완전·서로소다(8+8 → 7+9).

### Phase 1 — 배치 기준 명문화

`design-doc-authoring` SKILL.md에 배치 기준 섹션을 신설한다 (이 사실의 유일한 owner).

> **소비자 파급 테스트** — "이 사실이 바뀌면 이 패키지 _밖의_ 코드 또는 최종 사용자가 바뀌어야
> 하는가?" Yes → `SPEC.md` · No → `docs/design/`

경계 사례 표를 함께 싣는다:

| 사실                                            | 파급 | 위치     |
| ----------------------------------------------- | ---- | -------- |
| export 시그니처, SSOT 타입                      | 있음 | SPEC     |
| 에러 코드·카테고리·복구가능성                   | 있음 | SPEC     |
| 외부 관측 가능한 이벤트 이름·페이로드           | 있음 | SPEC     |
| 확장점(추상 클래스, 콜백 시그니처)              | 있음 | SPEC     |
| **최종 사용자 대상 계약**(키 바인딩, 시각 문법) | 있음 | **SPEC** |
| 모듈 분해, 파일 배치, 내부 헬퍼                 | 없음 | design   |
| 상태 기계의 _내부_ 전이                         | 없음 | design   |
| 렌더 파이프라인, 캐시 전략, 알고리즘 선택       | 없음 | design   |
| 왜 이 분해를 골랐는가 (분해의 동기)             | —    | design   |
| 단일 아키텍처 결정 + 기각된 대안                | —    | ADR      |

`spec-writing-standard`와 `spec-workflow.md`는 이 섹션으로 링크만 건다.

### Phase 1b — 표준 섹션에 `User-Facing Contract` 슬롯 신설 (선행 필수)

배치 기준만으로는 부족하다. 현행 표준 9필수 + 5선택 섹션에는 **최종 사용자 대상 계약을 담을 자리가
없다.** `agent-cli`의 `Keyboard Controls`(149줄) · `TUI Visual Grammar`(81줄)가 SPEC.md를 부풀린
근본 원인이 이것이다 — whitebox라서 흘러든 게 아니라, blackbox 계약인데 **정당한 표준 섹션이 없어서**
비표준 헤딩으로 존재해 왔다. 슬롯을 만들지 않으면 Phase 3의 유출 스캔이 정당한 계약을 계속 유출로
집계하고, 작성자는 올바른 이동처를 갖지 못한다.

- `spec-writing-standard` SKILL.md의 **선택 섹션** 목록에 `User-Facing Contract` 추가 —
  "최종 사용자가 직접 관측·의존하는 계약(키 바인딩, 터미널 시각 문법, 종료 코드 등). 소비자가 코드가
  아니라 사람인 경우에만 사용."
- `.agents/templates/spec-template.md`에 대응 섹션 추가.
- 이 섹션은 `tags: [cli, desktop]` 계열 패키지에서만 의미가 있으므로 **선택**이며 필수 9섹션은 불변.

### Phase 2 — 파일럿 추출 (신규 집필 아님, 이동)

- `packages/agent-framework/docs/SPEC.md` line 668–2593 → `docs/design/` 하위 2–3개 주제 문서로 분할.
- `packages/agent-cli/docs/SPEC.md` → `docs/design/tui-rendering.md` 등. **단** `Keyboard Controls`
  와 `TUI Visual Grammar`의 최종 사용자 계약 부분은 SPEC 잔류하되, Phase 1b의
  `## User-Facing Contract` 아래로 재배치한다(비표준 헤딩 → 표준 선택 섹션).
- 각 design doc은 MUST 5섹션(Context & Goal / Constraints / Internal Structure / Key Flows /
  Test Approach)을 채우고 owning SPEC으로 링크. SPEC에서도 design으로 역링크.
- 절차: Mode C drift recovery와 동일하게 **전용 PR, 기능 작업과 혼합 금지**.

### Phase 3 — 게이트 정직화

**실행 순서 주의:** 스캔은 Phase 2 **이전에** 작성한다. TC-04가 회수 _전_ 상태에서 정확히 2건을
검출하는 것을 요구하기 때문이다. 스캔이 나중에 오면 그 판정을 다시 만들 수 없으므로, 단위 테스트는
회수 전 스냅샷을 고정 픽스처로 박아 두고 실행 순서와 무관하게 재현되게 한다.

- `check-spec-whitebox-leakage.mjs` (신규, **advisory**): SPEC.md의 표준 섹션 밖 줄 수가
  **≥300 AND ≥40%** 이면 finding. 헤딩 별칭 허용(`Architecture` ≡ `Architecture Overview`).
  **대상 글롭은 `{packages,apps}/**/docs/SPEC.md`(중첩 포함)여야 한다** — 최상위 1단 글롭은
  `packages/dag-nodes/*` 20개를 통째로 놓친다(실패 모드 8).
- `check-design-doc-completeness.mjs`: owning SPEC 링크 warning을 **양방향**으로 확장.
- **표준 섹션 목록 SSOT화 (선행 필수).** 현재 이 목록은 두 곳에 복제되어 **이미 어긋나 있다** —
  `spec-writing-standard` SKILL.md는 필수 9개를 열거하는데 `cleanup-drift.mjs:13-22`의
  `SPEC_REQUIRED_SECTIONS`는 **8개뿐이고 `Class Contract Registry`가 빠져 있다.** 신규 스캔이 세 번째
  복사본을 만들면 드리프트가 확정된다. `scripts/harness/shared.mjs`에 필수 9 + 선택 6(Phase 1b의
  `User-Facing Contract` 포함) 상수를 하나 두고, `cleanup-drift.mjs`와 신규 스캔이 함께 import 한다.
  기존 8개 목록의 누락도 이 과정에서 교정된다(부수적 버그 수정, 본 항목 범위 내).

### Phase 4 — Live Spec mandate 범위 조정

`spec-workflow.md` > Live Spec Policy의 mandate 표에서
`New or changed behavior or semantics` 행을 **`New or changed externally observable behavior or
semantics`** 로 좁히고, 내부 동작 변경은 design doc으로 라우팅한다는 문장을 추가한다. 나머지 6행 불변.

## Affected Files

| 파일                                                                          | 변경                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.agents/skills/design-doc-authoring/SKILL.md`                                | 배치 기준 섹션 신설 (owner)                                                                                                                                                                                                                                  |
| `.agents/skills/spec-writing-standard/SKILL.md`                               | 배치 기준 링크 + 선택 섹션에 `User-Facing Contract` 추가 + "Required Sections Reference" 표에 선택 섹션 열거 (현재 필수 9만 있고 선택 5는 Mode A 절차문 안에만 있어 사실상 발견 불가 — GATE-WRITE 재판정에서 가디언이 "열거된 곳이 없다"고 결론낸 실증 사례) |
| `.agents/templates/spec-template.md`                                          | `User-Facing Contract` 선택 섹션 추가                                                                                                                                                                                                                        |
| `.agents/rules/spec-workflow.md`                                              | mandate 행 범위 조정 + 라우팅 문장                                                                                                                                                                                                                           |
| `.agents/specs/document-standards/index.md`                                   | Design/LLD 행 Status note 갱신                                                                                                                                                                                                                               |
| `scripts/harness/shared.mjs`                                                  | 표준 섹션 목록 SSOT 상수 신설 (필수 9 + 선택 6)                                                                                                                                                                                                              |
| `scripts/harness/cleanup-drift.mjs`                                           | 자체 8개 목록 제거 → SSOT import (누락된 `Class Contract Registry` 교정)                                                                                                                                                                                     |
| `scripts/harness/check-spec-whitebox-leakage.mjs`                             | 신규 (advisory)                                                                                                                                                                                                                                              |
| `scripts/harness/check-design-doc-completeness.mjs`                           | 양방향 링크 warning                                                                                                                                                                                                                                          |
| `.agents/rules/spec-workflow.md` (§ Document Authority and Content Placement) | **범위 확대(2026-08-16 승인)** — Design documents 행을 `packages/*/docs/design/` + 횡단 `.agents/specs/`로 정정, SPEC↔design 내용 분할은 배치 기준으로 링크 위임(복사 금지). 모순 스윕을 Evidence Log에 기록                                                 |
| `scripts/harness/check-document-authority.mjs`                                | **범위 확대** — `isDesignDoc()`이 `packages/*/docs/design/`를 인식하도록 확장                                                                                                                                                                                |
| `scripts/harness/workspace-packages.mjs`                                      | 소비 (신규 글롭 금지 — `listWorkspacePackageDirs()` 사용)                                                                                                                                                                                                    |
| `scripts/harness/run-all-scans.mjs`                                           | 신규 스캔 등록                                                                                                                                                                                                                                               |
| `scripts/harness/__tests__/spec-whitebox-leakage.test.mjs`                    | 신규 스캔 단위 테스트                                                                                                                                                                                                                                        |
| `packages/agent-framework/docs/SPEC.md`                                       | line 668–2593 추출 (이동)                                                                                                                                                                                                                                    |
| `packages/agent-framework/docs/design/*.md`                                   | 신규 (추출분 수용)                                                                                                                                                                                                                                           |
| `packages/agent-cli/docs/SPEC.md`                                             | whitebox 섹션 추출 (사용자 계약 잔류)                                                                                                                                                                                                                        |
| `packages/agent-cli/docs/design/*.md`                                         | 신규 (추출분 수용)                                                                                                                                                                                                                                           |

## Completion Criteria

- [x] TC-01: 배치 기준이 owner 문서에 존재 —
      `rg -q "consumer-impact test" .agents/skills/design-doc-authoring/SKILL.md` → exit 0, 그리고
      경계 사례 표에 최종 사용자 계약 행이 존재
      (`rg -q "End-user-facing contract" .agents/skills/design-doc-authoring/SKILL.md` → exit 0).
      **단정 문자열은 영어다** — `naming-style.md` > Language Policy가 하네스 자산을 포함한 그 외
      전부를 영어로 규정하므로, 한국어 토큰(`파급`)을 단정하던 초안 문구는 산출물이 준수해야 할
      규칙과 어긋났다. 검증 대상은 기준의 존재이지 그것을 적은 언어가 아니다
- [x] TC-02: `rg -c "design-doc-authoring" .agents/skills/spec-writing-standard/SKILL.md` → 1 이상
      (배치 기준 owner로의 링크가 존재하고, 기준 본문 복사본은 없음)
- [x] TC-03: `rg "New or changed externally observable behavior" .agents/rules/spec-workflow.md` → exit 0
- [x] TC-04: `node scripts/harness/check-spec-whitebox-leakage.mjs` 가 Phase 2 **이전** 스냅샷에서
      `agent-framework`·`agent-cli` 정확히 2건을 finding으로 보고 (단위 테스트 픽스처로 고정)
- [x] TC-05: **회수량과 무손실을 직접 단정한다.** (a) 아래 `### TC-05 검증 명령`의 블록을 그대로
      실행해 exit 0, (b) `packages/agent-cli/docs/design/*.md`의 본문 줄 합계 **≥200**(실측 300).
      **자리표시자를 쓰지 않는다** — 3라운드 심사에서 잡혔다. 앞선 문구는 `<분할 직전 ref>` 같은
      자리표시자에 `--allowances`도 빠져 있어 문자 그대로 실행하면 exit 1이었다. 기록된 기준과 실제로
      돌린 명령이 다른 것은 이 백로그가 다루는 바로 그 병(일하지 않고 통과하는 기준)의 다른 형태다.
      허용 목록도 명령줄이 아니라 저장소에 커밋된 `.split-allowances.json`에 있고, 13건 중 11건은
      도구가 검증한다 — 개명 9건은 대체 문자열이 실제로 목적지에 있는지, delete-and-link 2건은 소유
      문서로의 링크가 실재하는지. 나머지 2건(줄바꿈 재배치)만 서면 사유로 받는다.
      **(a)는 배치를 재지 않는다** — 목적지 집합이 `신 SPEC ∪ design 전부`이므로 계약이 design으로
      가도 통과한다. 무손실은 **필요조건이지 충분조건이 아니며**, 배치의 증거는 TC-07의 분류표다.
      이 기준은 세 번째 정정이고, 앞의 두 번(개명·강등으로 통과)과 달리 임계값이 아니라 대상을 바꿨다
- [x] TC-06: 파일럿(`agent-cli`)의 잔류 `##` 헤딩이 전부 표준 섹션으로 정규화된다 —
      `isStandardSpecSection()` 단정, 비표준 0개. **수용 기준이 아니라 관측 기록으로 강등한다.**
      TC-05의 빠져나갈 구멍을 닫는다고 적었던 것은 **거꾸로였다** — 20개 섹션을 표준 `##` 하나 아래로
      모으는 강등이 바로 TC-06을 만족시키는 방법이고, 그 강등이 TC-05의 구멍이었다. 정규화 자체는
      찾기 쉬워지는 실익이 있으므로 기록하되, 배치의 증거로는 쓰지 않는다

- [x] TC-07: **분류표 완결성** — 아래 `## Appendix — WU-B per-section classification`에서 **두 파일럿 62개**
      (`agent-cli` 34 + `agent-framework` 28) 원본 `##` 섹션이 전부 stay / merge / design /
      delete-and-link / ADR / drop 중 하나로 귀속되고 누락이 없다. `agent-framework` 분류는 표로만
      남고 diff는 `DOCS-025`가 진다 — 분류가 리뷰 대상이고 이동은 그 결과다. (초안의 "SPEC ≤700줄" 두 기준은
      **폐기**한다: `agent-framework`는 잔류해야 할 계약만 ≈1,430줄 — 표준 646 + `Public API` 665 +
      `Provider Resolution Order` 31 + `Turn Error Surfacing` 15 + `Import Rules` 33 +
      `Settings Configuration` 35 — 이라 도달 불가이고, 도달을 강제하면 **계약을 design으로 밀어내는
      압력**이 되어 WU-A가 세운 기준에 역행한다)
- [x] TC-08: `find packages/agent-cli/docs/design -name "*.md" | wc -l` → 3 이상
- [x] TC-09: `node scripts/harness/check-design-doc-completeness.mjs` → exit 0 (신규 design doc이
      MUST 5섹션을 전부 충족, 더 이상 vacuous 통과가 아님)
- [x] TC-10: 양방향 링크 — 각 신규 design doc에서 `rg "SPEC\.md" <design-doc>` exit 0 이고,
      `packages/agent-cli/docs/SPEC.md`에서 `rg "docs/design/"` exit 0
- [x] TC-11: `rg "Keyboard Controls" packages/agent-cli/docs/SPEC.md` → exit 0 (최종 사용자 계약이
      design으로 잘못 이동하지 않았음)
- [x] TC-12: 전체 유출량 **관측 기록**(수용 기준 아님). 두 끝점 모두 스캔을 **실행해서** 얻었다 —
      기준선 `96728940c`에서 표준 섹션 밖 **6,675 / 17,369줄 = 38.4%**, 임계 초과 **2건**;
      회수 후 **4,967 / 17,174줄 = 28.9%**, 임계 초과 **1건**(`agent-framework`, `DOCS-025`가 회수).
      **경고 — `agent-cli`의 1,708 → 0은 대부분 배치가 아니라 강등이다.** 실제로 파일을 떠난 것은
      ~195줄이고 나머지는 비표준 `##`을 표준 `##` 아래 `###`로 내린 결과다. 지표가 볼 수 없는
      변화이며, 이 항목이 수용 기준이 아닌 이유 그 자체다.
      **앞선 문구는 추정치 ≈6,185줄 / 35.6%를 적고 체크했다 — 실측과 1,218줄 어긋난다.** 4라운드
      심사가 잡았다. "기록한다"고 써놓은 자리에 실행하지 않은 추정을 적고 `[x]`를 친 것은, 기록된
      수치는 그것을 만든 실행에서 나와야 한다는 이 백로그의 논지를 정면으로 어긴 것이다. 초안이
      인용하던 7,172 / 41.8%는 파서 정정 이전 값이라 함께 폐기한다
- [x] TC-13: `pnpm harness:scan` → exit 0
- [x] TC-16: 중첩 워크스페이스 패키지가 스캔 범위에 포함됨 — `check-spec-whitebox-leakage.mjs --all`
      출력에 `packages/dag-nodes/` 항목이 **20건** 나타난다. **총 파일 수를 단정하지 않는다**: 구현 중
      확인된 대로 `packages/dag-nodes/docs/SPEC.md`는 `package.json`이 없는 컨테이너 디렉터리의
      문서라 워크스페이스 패키지가 아니며, 초안이 근거로 삼은 `find` 기반 87은 그것을 잘못 포함한
      숫자였다(SSOT 열거기 기준 86). 막아야 할 회귀는 **중첩 그룹 누락**이지 특정 총계가 아니다 —
      숫자 단정은 이 항목에서 네 번 틀렸다
- [x] TC-14: `rg "User-Facing Contract" .agents/skills/spec-writing-standard/SKILL.md .agents/templates/spec-template.md`
      → 두 파일 모두 hit, 그리고 `rg "^## User-Facing Contract" packages/agent-cli/docs/SPEC.md` → exit 0
      (슬롯이 정의되고 파일럿에서 실제로 사용됨)
- [x] TC-15: 표준 섹션 목록 SSOT — `rg -c "SPEC_REQUIRED_SECTIONS = \[" scripts/harness/cleanup-drift.mjs`
      → 0 (자체 복사본 제거됨) AND 단위 테스트가 파서 결과와 `spec-writing-standard/SKILL.md`의
      Required Sections Reference 표 사이의 **집합 동등성**을 단정한다. 길이 검사가 아니다 — 길이는
      이름이 하나 바뀌어도 통과하므로 이 항목이 고치려는 드리프트를 못 잡는다. 필수/선택은 **구별
      가능하게** 반환되어야 하고(`cleanup-drift`는 필수만, 유출 지표는 필수 ∪ 선택), 동등성 단정은
      **필수 표에 한정**한다. 표를 읽지 못하면 **fail-closed**(exit 1). `shared.mjs`에 하드코딩
      배열을 두지 않으므로 상수 길이를 단정하던 초안 문구는 폐기한다

### TC-05 검증 명령

체크리스트 항목 **안에** 펜스를 두지 않는다 — 리스트 안의 코드 블록은 들여쓰기가 어긋나기 쉽고,
4라운드 심사에서 실제로 닫는 펜스가 여는 펜스보다 8칸 깊어져 블록이 닫히지 않았고 `format-check`이
red가 됐다. 아래 블록은 그대로 복사해 실행할 수 있으며, 문서에서 추출해 실행한 결과가 exit 0이다.

```bash
node scripts/harness/verify-doc-split-preservation.mjs \
--ref 96728940c \
--source packages/agent-cli/docs/SPEC.md \
--target packages/agent-cli/docs/SPEC.md \
--target packages/agent-cli/docs/design/command-registry.md \
--target packages/agent-cli/docs/design/composition.md \
--target packages/agent-cli/docs/design/internal-structure.md \
--target packages/agent-cli/docs/design/message-architecture.md \
--target packages/agent-cli/docs/design/session-ownership.md \
--target packages/agent-cli/docs/design/subagent-wiring.md \
--allowances packages/agent-cli/docs/design/.split-allowances.json
```

## Test Plan

테스트 전략 도출: `type: RULE` → 단위 테스트. `tags: [infra, cli]` → CI 파이프라인 스모크 +
프로세스 스폰/stdout 단정. 문서·프로세스 백로그이므로 `manual` 대신 command-form / `rg` 패턴 /
`pnpm harness:*` 스모크를 기본으로 삼는다.

| TC-ID | Test Type | Tool / Approach                                                          | Notes                                                                                          |
| ----- | --------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| TC-01 | command   | `rg` 패턴 2건 (`consumer-impact test`, `End-user-facing contract`)       | 배치 기준 + 사용자 계약 예외가 owner 문서에 존재                                               |
| TC-02 | command   | `rg` 링크 존재 + 기준 본문 미복제 확인                                   | Non-Duplication 확인                                                                           |
| TC-03 | command   | `rg` mandate 행 문구                                                     | Phase 4 반영 여부                                                                              |
| TC-04 | unit      | `scripts/harness/__tests__/spec-whitebox-leakage.test.mjs` + 고정 픽스처 | 임계(≥300 AND ≥40%) 정확도. 오탐 픽스처(203/203, 210/210) 포함                                 |
| TC-05 | CI smoke  | `verify-doc-split-preservation.mjs` exit 0 + design 본문 줄 합계 ≥200    | 무손실 + 실물 회수량. **지표가 아니라 목적지를 잰다** — 헤딩 강등으로 만족 불가                |
| TC-06 | command   | `isStandardSpecSection()` 로 잔류 `##` 전수 판정                         | **관측 기록**(수용 기준 아님) — 강등으로 만족되므로 배치의 증거가 아니다                       |
| TC-07 | command   | 분류표의 원본 `##` 귀속 전수 확인 (62건)                                 | 분류 완결성 — 이 항목에서 유일하게 배치를 직접 재는 기준                                       |
| TC-08 | command   | `find … \| wc -l`                                                        | design doc 실물 존재                                                                           |
| TC-09 | CI smoke  | `node scripts/harness/check-design-doc-completeness.mjs` exit code       | vacuous green 해소 — 대상이 0이 아닌 상태에서 통과                                             |
| TC-10 | command   | `rg` 양방향 링크                                                         | 발견 가능성                                                                                    |
| TC-11 | command   | `rg`                                                                     | 최종 사용자 계약 잔류 회귀 방지                                                                |
| TC-12 | command   | `check-spec-whitebox-leakage.mjs` `::examined::` stdout 기록             | **관측 기록**. 기준선 6,675줄/38.4%(86개 전수) → 회수 후 값. 헤딩 적합성 지표라 수용 기준 아님 |
| TC-13 | CI smoke  | `pnpm harness:scan` exit code                                            | 전체 하네스 무회귀                                                                             |
| TC-14 | command   | `rg` 3건 (스킬·템플릿·파일럿 SPEC)                                       | `User-Facing Contract` 슬롯이 정의되고 실제 사용됨                                             |
| TC-15 | unit      | `rg` 복사본 부재 + vitest 로 파서 결과와 스킬 표의 **집합 동등성** 단정  | 표준 섹션 목록 3중 복제 방지 + 기존 8개 누락 교정. 길이 검사는 이름 변경을 못 잡음             |
| TC-16 | CI smoke  | `--all` 출력의 `dag-nodes/` 항목 수 == 20 단정                           | 중첩 워크스페이스 패키지 누락 회귀 방지 (HARNESS-057 준수)                                     |

## Tasks

- [x] [`.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md`](../../tasks/RULE-013-blackbox-whitebox-doc-boundary.md) — 생성 완료 (2026-08-16). TC-01~TC-16
      전부에 대응하는 태스크 25건(WU-A 19 · WU-B 6)과 `## Test Plan` 포함.
- **WU-A Recommendation Gate:** `REVIEW VERDICT: ENDORSE` | 2026-08-16 | `proposal-reviewer`
  (revision 1 — 1차 `REVISE`의 네 findings를 접은 뒤 승인). 전문은 태스크 파일
  `## Recommendation Gate — WU-A`에 기록. `backlog-execution.md` > Recommendation Gate가 요구하는
  판정 기록이다.

## Appendix — WU-B per-section classification

The reviewable artifact for WU-B. Every `##` section of both pilot SPECs is classified here **before**
any line is moved; the diff is the consequence of this table, not the other way round.

### The test being applied

From [`design-doc-authoring/SKILL.md`](../../skills/design-doc-authoring/SKILL.md) > Placement criterion:

> If this fact changed, would code outside this package — or an end user — have to change?

`yes` → `docs/SPEC.md`. `no` → `docs/design/`.

**Who the consumer is differs per package, and that is the whole point.** For `agent-framework` the
consumer is calling code, so the contract is exports, types, and events. For `agent-cli` the consumer is
**the person at the terminal**, so key bindings, visual grammar, exit codes, and prompts are contract —
they are not "UI detail". Reading "consumer" as "calling code" in a product shell is the mistake the
`End-user-facing contract` row of the boundary table exists to prevent.

### Disposition vocabulary

| Disposition       | Meaning                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| `stay`            | already a standard section, stays as-is                                    |
| `merge → X`       | consumer-impacting; folded into standard section X, no content lost        |
| `design`          | no consumer impact; moves to `docs/design/<file>.md`                       |
| `delete-and-link` | restates another document's fact; deleted, replaced by a link to the owner |
| `ADR`             | a decision with rationale; moves to `.design/decisions/`                   |
| `drop`            | roadmap/aspiration, not a specification; belongs in a task                 |

---

### Pilot 1 — `packages/agent-cli/docs/SPEC.md` (34 sections, 1,939 lines)

Consumer: **the end user at the terminal**, plus the few packages that import CLI types.

| #   | Section                                     | Lines | Would a change force an end user or outside code to change? | Disposition                      |
| --- | ------------------------------------------- | ----- | ----------------------------------------------------------- | -------------------------------- |
| 1   | Scope                                       | 26    | —                                                           | `stay`                           |
| 2   | Boundaries                                  | 38    | —                                                           | `stay`                           |
| 3   | Import Rules                                | 42    | yes — constrains what importers may reach for               | `merge → Boundaries`             |
| 4   | Architecture                                | 351   | mixed — see split below                                     | split                            |
| 5   | StatusBar Display                           | 99    | yes — what the user sees every turn                         | `merge → User-Facing Contract`   |
| 6   | TUI Visual Grammar                          | 81    | yes — the visual language the user reads                    | `merge → User-Facing Contract`   |
| 7   | Context Management (CLI Layer)              | 17    | yes — user-visible context behaviour                        | `merge → User-Facing Contract`   |
| 8   | Tool Call Display                           | 43    | yes                                                         | `merge → User-Facing Contract`   |
| 9   | Slash Commands                              | 129   | yes — the command vocabulary is the CLI's API               | `merge → User-Facing Contract`   |
| 10  | Session Ownership — TuiInteractionChannel   | 33    | no — which class holds the session                          | `design/session-ownership.md`    |
| 11  | Command Registry Architecture               | 111   | mixed — see split below                                     | split                            |
| 12  | Type Ownership                              | 16    | —                                                           | `stay`                           |
| 13  | Public API Surface                          | 9     | —                                                           | `stay`                           |
| 14  | File Structure                              | 46    | no — a directory tree of internals                          | `design/internal-structure.md`   |
| 15  | CLI Usage                                   | 128   | yes — flags and invocation are the contract                 | `merge → User-Facing Contract`   |
| 16  | Tool Output Limits                          | 5     | yes — truncation the user observes                          | `merge → User-Facing Contract`   |
| 17  | Zero-Config Startup (env-default)           | 14    | yes — first-run behaviour                                   | `merge → User-Facing Contract`   |
| 18  | First-Run Setup                             | 82    | yes — the onboarding flow the user walks                    | `merge → User-Facing Contract`   |
| 19  | Session Logging                             | 4     | yes — where a user's transcript lands                       | `merge → Configuration`          |
| 20  | Tool Execution Display                      | 88    | yes                                                         | `merge → User-Facing Contract`   |
| 21  | Keyboard Controls                           | 149   | yes — key bindings are a hard contract                      | `merge → User-Facing Contract`   |
| 22  | Plugin Management TUI                       | 21    | yes                                                         | `merge → User-Facing Contract`   |
| 23  | Subagent Execution                          | 135   | mixed — see split below                                     | split                            |
| 24  | Memory Management                           | 32    | yes — the inspection surface the user drives                | `merge → User-Facing Contract`   |
| 25  | Edit Checkpointing                          | 27    | yes — undo semantics the user relies on                     | `merge → User-Facing Contract`   |
| 26  | Message Architecture                        | 25    | no — which internal type the list holds                     | `design/message-architecture.md` |
| 27  | Distribution — Bun single binary (DIST-001) | 23    | yes — how the user obtains and runs the binary              | `merge → Dependencies`           |
| 28  | Known Limitations                           | 8     | yes — behaviour the user will hit                           | `merge → User-Facing Contract`   |
| 29  | Dependencies                                | 49    | —                                                           | `stay` (`Dependencies`, O4)      |
| 30  | Extension Points                            | 18    | —                                                           | `stay`                           |
| 31  | Process Survival Boundary (ERR-001 G1)      | 15    | yes — what survives a crash                                 | `merge → Error Taxonomy`         |
| 32  | Error Taxonomy                              | 20    | —                                                           | `stay`                           |
| 33  | Test Strategy                               | 32    | —                                                           | `stay`                           |
| 34  | Class Contract Registry                     | 21    | —                                                           | `stay`                           |

#### Splits

**§4 `Architecture` (351 lines)**

| Subsection                                                                                                                                       | Consumer impact                                            | Disposition                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------- |
| Lead prose + composition-map pointer                                                                                                             | orientation                                                | `merge → Architecture Overview` |
| Transparent Workflow Boundary / User-Local Storage Boundary / Transparent Process Execution Boundary / Repository Situational Awareness Boundary | yes — what the CLI shows and touches on the user's machine | `merge → User-Facing Contract`  |
| Provider Profile Creation / Provider Configuration UX / Preset Selection / Durable Memory Enablement                                             | yes — settings keys, flags, precedence                     | `merge → Configuration`         |
| Transport Registry                                                                                                                               | no — internal composition                                  | `design/composition.md`         |

**§11 `Command Registry Architecture` (111 lines)**

| Subsection                                                          | Consumer impact                                        | Disposition                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
| `ICommandSource` interface / `ICommand` interface / Command Sources | yes — third parties implement these                    | `merge → Extension Points`                                |
| Skill Frontmatter Schema                                            | yes — users author SKILL.md files against it           | `merge → Extension Points`                                |
| Skill Invocation Methods / Skill Execution Features                 | yes — how a user runs a skill                          | `merge → User-Facing Contract`                            |
| Skill Discovery (Multi-Path)                                        | yes — where the CLI looks for a user's skills          | `merge → User-Facing Contract`                            |
| Skill Execution (the resolution + submission pipeline)              | no — the pipeline behind the syntax                    | `design/command-registry.md`                              |
| Variable Substitution / Shell Command Preprocessing                 | **yes** — a user types these into their own `SKILL.md` | `merge → Extension Points` (corrected in the second pass) |

**§23 `Subagent Execution` (135 lines)**

| Content                                                    | Consumer impact | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent-definition format, invocation, what the user sees    | yes             | `merge → User-Facing Contract`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Restatement of `agent-framework`'s runner/manager contract | owned elsewhere | `delete-and-link` → `agent-framework/docs/SPEC.md` — **executed**, one paragraph: the subagent-lifecycle restatement, deleted from `design/subagent-wiring.md` and replaced by the link. A second paragraph was deleted alongside it but is **not** this row: the round-4 review found it was an in-package duplicate of `agent-cli`'s own `## Boundaries` (base ref line 52), not an `agent-framework` restatement. The round-3 review had caught that the first two passes moved both into the design doc instead — the drift-preservation this document criticises for Pilot 2 |
| CLI-side wiring                                            | no              | `design/subagent-wiring.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

#### Deep subsections — classified in the second pass

The first pass classified whole `##` sections and sent a mixed subsection wherever its bulk pointed.
That was wrong in **both** directions, and the review caught both. These eight are `###`/`####`
sections of the original — inside the granularity this table claims to operate at — so they are
classified here rather than covered by a disclaimer.

**Contract that had wrongly left the SPEC (returned):**

| Source                                                                            | Why it is contract                                                                          | Now                                                     |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `### Variable Substitution` (`$ARGUMENTS`, `${PROJECT_DIR}`, `${CLAUDE_MODEL}` …) | a user types these into their own `SKILL.md`; renaming one breaks every existing skill file | `Extension Points` → `### Skill Body Syntax`            |
| `### Shell Command Preprocessing` (`` !`command` ``)                              | same file, same author, same breakage                                                       | `Extension Points` → `#### Inline shell execution`      |
| `/background` subcommand + argument table, and "must not expose raw task IDs"     | command grammar the user types, and a rule about what the panel may show                    | `User-Facing Contract` → `### Background Work Controls` |
| `transports` key in `settings.json`                                               | a settings key the user edits                                                               | `Configuration` → `### Transport Settings`              |

The first two are the sharpest error: the table kept `### Skill Frontmatter Schema` as contract on the
grounds that _"users author SKILL.md files against it"_, then sent the **body syntax of the same
user-authored file** to design. The frontmatter of a file being contract while its body is not is not a
boundary — it is an inconsistency.

**Whitebox that had stayed, laundered under a standard heading (extracted):**

| Source                            | Why it is not contract                                                                                               | Now                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `#### React.memo`                 | a render optimisation — the boundary table's own `Render pipeline` row                                               | `design/message-architecture.md` |
| `#### Message Windowing`          | `MAX_RENDERED_MESSAGES`, the in-memory render tree                                                                   | `design/message-architecture.md` |
| `#### Tool State Cleanup`         | `MAX_COMPLETED_TOOLS`, the `activeTools` array                                                                       | `design/message-architecture.md` |
| `#### Command Module Composition` | `assembleProduct`, base ⊕ packs merge order — and it was parented under `StatusBar Display`, where it never belonged | `design/composition.md`          |
| `#### Testing Requirements`       | a test instruction, 640 lines away from `## Test Strategy`                                                           | SPEC `## Test Strategy`          |

The windowing left one consumer-facing residue behind, kept as `### Transcript Retention`: the render
tree is windowed, the transcript on disk is not. That sentence is the promise; the numbers are not.

#### Granularity, stated explicitly

What remains unclassified is **sentence-level**, not section-level: `Preset Selection` names
`selectPresetId()` and `resolveShellPreset()` in `src/startup/preset-selection.ts`; `Durable Memory
Enablement` names `src/startup/memory-enablement.ts`; `Provider Configuration UX` names the settings
documents it writes. Splitting those mid-paragraph is a different quality of work from applying the test
to a section, and folding it into this diff would make the classification unreviewable. **It is out of
WU-B's scope and named here rather than left silent.**

#### Pilot 1 outcome

- Everything retained normalizes to one of the fifteen standard sections.
- **300 body lines** live in `packages/agent-cli/docs/design/` across six files.
- **Two paragraphs** are deleted-and-linked — both paraphrases of what `agent-framework` owns, replaced
  by a link to the owner in `design/subagent-wiring.md`. **The earlier "`≈ 20 lines`" was an estimate
  that was never executed and the author's own tool refutes it**: `verify-doc-split-preservation.mjs`
  reported zero deletions for two passes, which is only consistent with `delete-and-link` having been
  applied to nothing. The round-3 review caught it. The paragraphs had instead been _moved into_ the
  design doc — preserving another package's contract as a paraphrase under a new filename, which is
  precisely what this document argues against for Pilot 2's `## Feature Details`.
- **Zero body lines lost**, proved mechanically rather than by reading a reordered diff:
  `verify-doc-split-preservation.mjs` compares the multiset of body lines at the pre-split ref against
  the new SPEC plus all six design docs. Thirteen allowances live in a committed file,
  `packages/agent-cli/docs/design/.split-allowances.json`, each with a written reason, and **eleven of
  them are checked by the tool rather than trusted**: nine renames must name a replacement line that is
  really present in a destination, and two delete-and-links must name an owner a destination really
  links to. Only two — sentences whose line breaks moved — rest on the reason alone. An allowance list
  passed on the command line, as the first attempt did, leaves no artifact a reviewer can audit; that is
  the same disease this item is about, in a new shape.
- The claim that **"nothing user-facing is moved out of the SPEC" was false on the first pass** and is
  what the second pass fixed. Four contract facts had left; they are back, and the eight sections
  involved are classified above. The reviewer's P3 objection is this table's premise, and the first pass
  still violated it in the opposite direction — which is why the table, not the diff, is the artifact
  under review.

**The extraction is far smaller than the leakage metric implied, and that is the finding.** The scan
reported 1,708 of 1,939 lines (88.1%) outside a standard heading, but only `≈ 260` of those are actually
misplaced. The other `≈ 1,450` are genuine consumer contract filed under non-standard headings — key
bindings, visual grammar, slash commands, first-run flow. **`check-spec-whitebox-leakage.mjs` measures
heading nonconformance, not misplacement**, which is exactly why WU-A ships it as advisory and why TC-12
was demoted from an acceptance criterion to a recorded observation. A pilot that "fixed" 88.1% would have
been moving contract out of the contract document.

**And the same diagnosis disqualifies the metric as an acceptance criterion at all — a point this
document initially made and then failed to act on.** `check-spec-whitebox-leakage.mjs:62` marks a span
only on `/^##\s+/`, so every `###` is attributed to its enclosing `##`. Demoting a non-standard `##` to
`###` under a standard one drives the residual to zero **without moving a line**, which is exactly what
this pilot did: 20 non-standard `##` became `###`, and `agent-cli` reported `0/1731`. TC-05 was rewritten
to assert destination volume and losslessness instead, and TC-06 — which a demotion _satisfies_ — was
demoted to an observation. The metric's blind spot is filed against `HARNESS-052` (second axis, sub-shape
**A**: a check that measures something other than what its name claims).

---

### Pilot 2 — `packages/agent-framework/docs/SPEC.md` (28 sections, 2,649 lines)

Consumer: **calling code** (`agent-cli`, servers, workers, third-party SDK users).

#### The structural finding, before any classification

This file is **two documents concatenated**. L3–694 is a migrated, standard-section SPEC. L695 restarts
with `## Overview` — "Robota SDK is a programming SDK built by assembling existing Robota packages" —
and runs another 1,955 lines with its own `Architecture`, `Feature Details`, and `Public API`.

The seam is not a hypothesis; the document states it. `## Architecture Overview` (L63) says _"See the
'Architecture' section below for the full package dependency chain and feature layout."_ And
`## Public API Surface` (L161, an export table) and `## Public API` (L1342, per-export prose) are the same
subject in two forms, 1,181 lines apart.

**This is a document-concatenation defect, not a blackbox/whitebox defect.** The consumer-impact test
classifies the content correctly — the table below does exactly that — but applying it here also requires
reconciling two overlapping descriptions of the same package, section by section, and deciding which
version is current wherever they disagree. That is a different and much larger job than the pilot, and
RULE-013's criterion neither causes it nor fixes it.

#### Classification

| #   | Section                                           | Lines | Would a change force outside code to change?            | Disposition                           |
| --- | ------------------------------------------------- | ----- | ------------------------------------------------------- | ------------------------------------- |
| 1   | Scope                                             | 8     | —                                                       | `stay`                                |
| 2   | Boundaries                                        | 52    | —                                                       | `stay`                                |
| 3   | Architecture Overview                             | 18    | —                                                       | `stay` (drop the "see below" pointer) |
| 4   | Type Ownership                                    | 80    | —                                                       | `stay`                                |
| 5   | Public API Surface                                | 160   | yes                                                     | `stay` (absorbs §16)                  |
| 6   | Extension Points                                  | 187   | yes                                                     | `stay`                                |
| 7   | Provider Resolution Order                         | 31    | yes — which provider answers a call is observable       | `merge → Configuration`               |
| 8   | Turn Error Surfacing & Liveness (ERR-001)         | 15    | yes — the error surface                                 | `merge → Error Taxonomy`              |
| 9   | Error Taxonomy                                    | 31    | —                                                       | `stay`                                |
| 10  | Test Strategy                                     | 68    | —                                                       | `stay`                                |
| 11  | Class Contract Registry                           | 42    | —                                                       | `stay`                                |
|     | **— seam: second document begins at L695 —**      |       |                                                         |                                       |
| 12  | Overview                                          | 6     | duplicate of §1                                         | `delete-and-link → Scope`             |
| 13  | Core Principles                                   | 15    | partly — rules 5 and 6 constrain importers              | `merge → Boundaries`                  |
| 14  | Architecture                                      | 161   | mixed — see split                                       | split                                 |
| 15  | Feature Details                                   | 465   | restates other packages, **already drifted**            | `delete-and-link` + split             |
| 16  | Public API                                        | 665   | yes — signatures, event names, payloads                 | `merge → Public API Surface` (dedupe) |
| 17  | Import Rules                                      | 33    | yes — what a consumer may import                        | `merge → Boundaries`                  |
| 18  | Design Decision Records                           | 34    | no — decisions with rationale                           | `ADR`                                 |
| 19  | Hook Type Executors (SDK-Specific)                | 11    | yes — hook contract                                     | `merge → Plugin/Hook Contract`        |
| 20  | Settings Configuration                            | 35    | yes                                                     | `merge → Configuration`               |
| 21  | Bundle Plugin System                              | 23    | yes — plugin authors depend on it                       | `merge → Plugin/Hook Contract`        |
| 22  | Marketplace Client                                | 9     | yes — exported                                          | `merge → Public API Surface`          |
| 23  | System Prompt Skill and Agent Injection           | 84    | mixed — injected content is observable, assembly is not | split                                 |
| 24  | Hook Wiring into Session Lifecycle                | 11    | no — wiring order                                       | `design/hook-wiring.md`               |
| 25  | Background Task Execution                         | 122   | mixed — exports yes, dedup/eviction internals no        | split                                 |
| 26  | Subagent Execution                                | 247   | mixed — ports and definition format yes, runners no     | split                                 |
| 27  | Autonomous Goal Pursuit (GOAL-001)                | 27    | yes — observable behaviour                              | `merge → State Lifecycle`             |
| 28  | Unconnected Packages (Future Integration Targets) | 7     | no — a roadmap                                          | `drop` (file as a task)               |

#### Splits

| Source                                        | Consumer-impacting part                                                                                                                | Non-impacting part                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| §14 `Architecture`                            | Package Dependency Chain → `merge → Boundaries`                                                                                        | Client–SDK–Session Relationship, Package Roles, Feature Layout → `design`                        |
| §15 `Feature Details`                         | the 12 `(SDK-Specific)` subsections describe framework-owned behaviour                                                                 | the rest restates `agent-core`/`agent-session`/`agent-tools`                                     |
| §23 `System Prompt Skill and Agent Injection` | what ends up in the prompt → `merge → Extension Points`                                                                                | how it is assembled → `design`                                                                   |
| §25 `Background Task Execution`               | exports → `merge → Public API Surface`                                                                                                 | wake dedup and eviction → `design`                                                               |
| §26 `Subagent Execution`                      | `SubagentRunner` port, agent-definition format, `defaultTools`/`additionalTools`, `createSubagentSession` → `merge → Extension Points` | `WorktreeSubagentRunner`, `AgentDefinitionLoader`, prompt assembly, transcript logger → `design` |

#### §15 is the load-bearing example

`## Feature Details` is 465 lines describing the session, permission, hook, tool, and sandbox systems —
none of which `agent-framework` owns. It has **already drifted**: `agent-core`'s SPEC lists sixteen hook
events, this copy lists six. Moving it to `docs/design/` would preserve the drift under a new filename.
The correct disposition is `delete-and-link`: the owner's SPEC is the single source, and the framework
links to it. This is what the Non-Duplication rule requires and what the consumer-impact test independently
arrives at — a restatement has no consumer impact of its own, because changing it changes nothing.

#### Pilot 2 outcome, and the recommendation

Applying the table honestly means: dedupe 665 lines against 160, delete-and-link ~350, extract ~600 to
design, and reconcile two descriptions of the same package wherever they disagree. That is a rewrite of a
2,649-line SPEC, not a pilot — an order of magnitude past the PR Unit Rule's ~600-line soft ceiling, and it
would put the boundary criterion and a pre-existing concatenation defect in one unreviewable diff.

**Recommendation: WU-B ships pilot 1 only.** The concatenation is filed as its own backlog item, with this
table as its starting analysis. One pilot is what WU-B needs to prove — that the criterion is decidable
against a real SPEC and produces a defensible answer for every section. Pilot 1 does that for all 34 of its
sections, and this table does the classification work for pilot 2 without spending the diff.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-15

**Status upgrade:** draft → review-ready

**Ordering check:** GATE-WRITE is the entry gate (gate-catalogue.md > Prior-gate map: "GATE-WRITE has no
prior status gate"); no prior-gate PASS required. Input state matches: frontmatter `status: draft`, file
located in `.agents/spec-docs/draft/`.

**Frontmatter**

- File begins with `---` YAML block: yes, lines 1–5.
- `status: draft` present: yes, line 2.
- `type:` one of the 11 prefixes: `RULE` (line 3) — valid, exactly one value.
- `tags:` present: yes, `[infra, cli]` (line 4).

**Problem section**

- Concrete symptom: five measured symptoms with commands and figures — `find … docs/design/*.md | wc -l`
  → 0; 7,172 of 17,139 SPEC lines (41.8%) outside the standard sections; per-file table
  (agent-framework 1,975/2,594 = 76.1%, agent-cli 1,710/1,939 = 88.2%). Independently re-verified: design
  docs = 0; `wc -l` = 2593/1938/1306 (doc states 2,594/1,939/1,307 — consistent +1 counting offset,
  immaterial); `agent-cli` `## Public API Surface` spans lines 989–997 before `## File Structure` at 998
  = 9 lines, exactly as claimed; `agent-framework` standard sections end at `## Class Contract Registry`
  (626) and a separate document begins at `## Overview` line 668, exactly as claimed.
- Reproduction condition: present — "재현 조건" (lines 58–59) names the four commands and states no
  branch/environment dependency. Confirmed reproducible from the repository root.
- No "TBD"/"TODO"/vague single sentence: `rg "TBD|TODO|works correctly|no errors"` over the document →
  no match (exit 1).
- Observation (not a criterion violation): the 67-file scope (57 packages + 10 apps) is the top-level
  `*/docs/SPEC.md` glob and excludes 20 nested `packages/dag-nodes/*/docs/SPEC.md` (87 total). The scope
  is stated in the document and TC-12's baseline uses the same aggregate, so it is internally consistent
  and reproducible.

**Prior Art Research**

- `## Prior Art Research` section present: yes, line 61.
- Substantiated: yes — 4 sources, 10 http documentation citations, all documentation-class (standards
  catalogue entries, published standard PDFs, arc42 docs), no third-party source code. Reachability
  probed: `docs.arc42.org/section-5/` → HTTP 200; `standards.ieee.org/ieee/1016/4502/` and
  `iso.org/standard/72089.html` → 403 (bot challenge, not 404). ≥1 citation verified live.
- `Waived:` line: N/A — the section is substantiated, so the opt-out branch does not apply.
- Findings feed Alternatives/Decision: yes — A2's con is grounded in arc42 selectivity, A4's con in
  Parnas "fake it" reconstruction cost, and the Decision derives the placement test from the stated
  cross-source finding ("정보 은닉의 secret", lines 185–187) rather than asserting it.
- Dispatch note: the section records (lines 63–65) that it was researched in-session without dispatching
  `prior-art-researcher`. Judged NOT disqualifying: the catalogue criterion governs substantiation, and
  `research.md`'s MUSTs bind the research's substance and evidence class (product documentation, comparable
  references, before spec finalization) — all satisfied. The worker/guardian/floor split in `research.md`
  assigns roles in the normal pipeline; it is not phrased as a validity condition on the artifact. The
  deviation is disclosed in the document rather than concealed, and `scan-spec-research.mjs` exits 0.

**Architecture Review Checklist**

- All 4 checklist items `[x]`: yes, lines 234–240.
- Sibling scan `[x]` with completion evidence: yes — names RULE-007/008/009/010/011 and states this item
  fills RULE-009's placement-criteria gap without redefining a type. Verified all five exist under
  `.agents/spec-docs/done/`.
- Alternatives ≥2 with pro/con: 4 (A1–A4), each with an explicit Pro and Con; A3 additionally carries 완화.
- Decision references the driving trade-off: yes — "근거는 비용 비대칭이다", contrasting A3's zero new
  process against A1's 7,172 permanently ungated lines, A2's ~60 phantom docs, and A4's reconstruction cost.
- New-surface placement (conditional): **N/A** — the spec introduces no new package, app, or
  presentation/interface surface and reclassifies no layer or product-family boundary. It adds one harness
  script beside ~40 existing ones, populates the `docs/design/` document type already defined by RULE-009,
  and adds one optional SPEC section. Per `spec-workflow.md` > New-Surface Architecture Placement the rule
  targets code-architecture placement; a document-content boundary is not in scope. The Sibling scan and
  Decision nonetheless name the analogous existing layer (Parnas Module Guide / MIS / Internal Design ↔
  `architecture-map` / `SPEC.md` / `docs/design/`) and keep the fact's owner single (`design-doc-authoring`,
  links only elsewhere).

**Completion Criteria**

- Every item carries a `TC-N` prefix: yes, TC-01 … TC-15, 15 items, no unprefixed item.
- ≥1 criterion per distinct feature: yes — Phase 1 → TC-01/TC-02, Phase 1b → TC-14, Phase 2 → TC-06/07/08/
  10/11, Phase 3 → TC-04/05/09/15, Phase 4 → TC-03, plus regression TC-12/TC-13.
- Command or observable form: every criterion is command form (`rg`, `wc -l`, `find`, `node …`,
  `pnpm harness:scan`) with an explicit expected exit code or numeric threshold.
- No banned vague phrasing ("works correctly", "no errors", "implemented", "displays correctly"): confirmed
  by scan, no match.

**Test Plan**

- `## Test Plan` section present: yes, line 371.
- One row per TC-N: 15 criteria vs 15 table rows, TC-01…TC-15 on both sides — counts and IDs match exactly.
- Non-empty Test Type and Tool/Approach on every row, no "TBD": confirmed (command ×10, unit ×2,
  CI smoke ×3).
- Manual rows: N/A — no row uses "manual"; the preamble states manual was deliberately avoided in favour of
  command-form checks.

**Structure**

- Tasks section present with placeholder: yes — line 397, `.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md` — 미생성.
- Evidence Log present and empty at the time of this first GATE-WRITE run: yes, heading at line 399 with no
  entries below it.
- No `## Status` / `## Classification` in the body: confirmed — H2 set is Problem, Prior Art Research,
  Architecture Review, Fallback & Degradation Declaration, Solution, Affected Files, Completion Criteria,
  Test Plan, Tasks, Evidence Log.

**Mechanical floors (re-run by this gate):** `node scripts/harness/check-spec-doc-frontmatter.mjs` → exit 0
(261 spec documents examined; 4 pre-existing duplicate-ID warnings, none for RULE-013);
`node scripts/harness/scan-spec-research.mjs` → exit 0 (7 spec documents examined).

**TC-N count confirmation:** Completion Criteria = 15 (TC-01…TC-15); Test Plan rows = 15 (TC-01…TC-15).
Counts match.

### [GATE-WRITE] — ✅ PASS | 2026-08-15 (re-run)

**Status upgrade:** draft → review-ready

**Supersedes:** the preceding `[GATE-WRITE] — ✅ PASS | 2026-08-15` entry **for the corrected criteria
only** (Problem §2 baseline, Alternatives A1 Con, Decision aggregate, Adversarial pass count, Phase 3 glob
requirement, Completion Criteria TC-12/TC-16, Test Plan rows). That entry stays as history and remains
accurate for the criteria it recorded; where the two entries disagree on a figure, this one governs. The
document was edited after the first PASS, so this re-run re-derives the numbers against the current file.

**Ordering check:** unchanged — GATE-WRITE is the entry gate (gate-catalogue.md > Prior-gate map), no prior
gate required. Input state still matches: `status: draft`, file in `.agents/spec-docs/draft/`.

**Re-derived corpus measurement (independent script over `{packages,apps}/**/docs/SPEC.md`, sections
delimited by `^## ` heading spans, total = `split('\n').length`):**

| Figure                            | Document claims   | Re-derived        | Result      |
| --------------------------------- | ----------------- | ----------------- | ----------- |
| SPEC.md file count (nested incl.) | 87                | 87                | exact match |
| Total lines                       | 17,139            | 17,139            | exact match |
| Top-level-only total (old scope)  | 16,017            | 16,017            | exact match |
| Nested `dag-nodes` files          | 20                | 20                | exact match |
| Nested total lines                | 1,122             | 1,122             | exact match |
| Nested lines outside standard     | 207 (18.4%)       | 207 (18.4%)       | exact match |
| `agent-framework` row             | 2,594/1,975/76.1% | 2,594/1,975/76.1% | exact match |
| Corpus lines outside standard     | 7,172 (41.8%)     | 7,586 (44.3%) †   | see note †  |

† **Not exactly reproducible, and the reason is a repository gap, not a document error.** The metric is
"필수 9 + 선택 5" but the _optional five_ are enumerated nowhere: `spec-writing-standard` SKILL.md >
Required Sections Reference lists only the 9, and `.agents/templates/spec-template.md` contains only the 9.
Measuring with required-9-only exact-heading matching yields 7,586 corpus-wide and 7,379 for the top-level
67 — a **constant +414 offset against both the new and the old baseline**, so it cancels out of every delta
the correction rests on. The corrected deltas verify exactly: 17,139 − 16,017 = **1,122** (the nested total)
and 7,172 − 6,965 = **207** (the nested outside count). The coordinator's premise is confirmed.

**Arithmetic in the corrected TC-12, re-computed:** 7,172 − 3,685 = **3,487** residual; 17,139 − 3,455 =
**13,684** new total; 3,487/13,684 = **25.5%**; 1,975 + 1,710 = 3,685 and 3,685 − 230 = 3,455. The claim
that the previous threshold failed again holds: **3,487 > 3,400**. The new threshold is satisfiable:
3,487 ≤ 3,600 and 25.5% ≤ 30%, headroom 113 lines.

**Frontmatter (4/4):** unchanged and re-checked — `---` block lines 1–5, `status: draft`, `type: RULE`,
`tags: [infra, cli]`.

**Problem (3/3):** concrete symptom — the corrected §2 now states its glob scope explicitly (line 30) and
quantifies the omission it corrects (lines 31–33); all re-derivable figures reproduce exactly per the table
above. Reproduction condition present (lines 64–65) and confirmed. No TBD/TODO/vague phrasing in the body.
Design-doc count re-verified: still **0**.

**Prior Art Research (4/4):** untouched by the edit and re-verified — section at line 67, 4 sources, 10
documentation-class citations, `docs.arc42.org/section-5/` re-probed → **HTTP 200**. Findings still drive
A2/A4 and the Decision's placement test (lines 191–193). `Waived:` branch N/A (substantiated). The
in-session research without a `prior-art-researcher` dispatch is judged as in the first entry — disclosed,
substantively compliant with `research.md`, not disqualifying.

**Architecture Review Checklist (5/5):** all 4 items `[x]`; sibling scan evidence intact (RULE-007/008/009/
010/011, all five re-confirmed present under `.agents/spec-docs/done/`); 4 alternatives each with Pro and
Con, A1's Con now carrying the corrected 41.8%/7,172; Decision names the cost-asymmetry trade-off with the
corrected 7,172. Internal consistency of the edit checked: the Adversarial pass claims 8 failure modes
(line 206), the list contains exactly **8** numbered items, and the checklist's line 254 also says 8 — the
count was propagated to all three places. New-surface placement remains **N/A** for the reason recorded in
the first entry; the edit introduced no new surface.

**Completion Criteria (4/4):** TC-01…TC-16, **16 items, every one TC-N-prefixed**. New TC-16 is in
observable form (scan must print `::examined::` ≥ 87) and is the regression guard for the defect this
correction found. ≥1 criterion per feature still holds, with Phase 3's glob requirement (lines 318–319) now
covered by TC-16. All criteria remain command/observable form with explicit exit codes or thresholds; none
of the four banned phrasings appear.

**Test Plan (4/4):** 16 criteria vs **16 rows**, IDs TC-01…TC-16 on both sides — counts and IDs match. Every
row has non-empty Test Type and Tool/Approach, no "TBD" (command ×10, unit ×2, CI smoke ×4). Manual-Notes
criterion N/A — no row uses "manual". TC-12's row carries the corrected baseline 7,172/41.8% and the TC-16
row is present.

**Structure (2 met, 1 N/A):** Tasks placeholder present (line 418). "Evidence Log present and empty" is
**N/A on a re-run** — the catalogue scopes that item to the first GATE-WRITE run; the section holds exactly
one prior entry, the 2026-08-15 GATE-WRITE PASS, in catalogue format, unaltered by this run. No `## Status`
or `## Classification` in the body.

**Mechanical floors, re-run against the edited file:** `check-spec-doc-frontmatter.mjs` → exit 0;
`scan-spec-research.mjs` → exit 0.

**Observations recorded, neither being a GATE-WRITE criterion:**

1. _TC-12's threshold is still metric-dependent._ Its achievability turns on which standard-section list
   the not-yet-written aggregate script uses. Required-9-only: residual ≈ 3,852 > 3,600 → **TC-12 would
   fail a third time**. The document's 필수 9 + 선택 5: 3,487 ≤ 3,600 → passes. Phase 3 pins the SSOT
   constant at 필수 9 + **선택 6** (adding `User-Facing Contract`) — a third basis, unmeasured. No gate
   criterion requires a threshold to be achievable, so this does not affect the verdict; it is recorded
   because this criterion has now been corrected twice and the remaining variance is the same class of
   defect.
2. _TC-16 is listed between TC-13 and TC-14 in Completion Criteria_ while the Test Plan lists it last.
   Cosmetic only — the criterion requires matching count and IDs, which holds.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-16

**Status upgrade:** review-ready → approved

**Ordering check:** prior gate `GATE-WRITE` shows PASS — two entries above (`[GATE-WRITE] — ✅ PASS |
2026-08-15` and its `(re-run)`, the latter superseding the former for the corrected figures). Input state
matches the prior-gate map: frontmatter `status: review-ready` (line 2), and the file sits in
`.agents/spec-docs/backlog/`, which is the folder `spec-workflow.md` > Spec-Document Status and Lifecycle
Folders (line 161) maps to `review-ready`.

- **User has provided explicit approval in the current conversation:** met. Verbatim statement: `승인`
  — the user's full message, relayed by the dispatching orchestrator as given in the current session
  immediately before this invocation. `승인` is the first token in this catalogue's own "What counts as
  explicit approval" list. Verification limit recorded honestly: a guardian subagent cannot read the
  orchestrator's conversation, so this criterion rests entirely on the relayed quote; no repository
  artifact can corroborate or contradict it.
- **Approval is a direct, unambiguous statement directed at this spec document:** met. The message it
  answered named GATE-APPROVAL on this document as the pending sign-off and stated the agent would not
  self-approve. The only other item in that message (HARNESS-093) was a "should I run GATE-WRITE" question,
  and GATE-WRITE requires no user approval — so it is not a competing referent for a sign-off token, and the
  catalogue's "Approval of a different item in the same conversation" exclusion does not fire. Under every
  plausible reading of `승인` in that context, this document's approval is included. Explicitly NOT decided
  here and outside this gate's scope: whether `승인` also authorizes the HARNESS-093 GATE-WRITE run.
- **No Architecture Review or frontmatter type/tags modified after approval:** met. Two edits were disclosed
  as made after the second GATE-WRITE PASS and before the sign-off request; both verified against the
  current file, both outside the protected surfaces — (1) the metric-basis paragraph inside TC-12
  (lines 381–386, `## Completion Criteria`), (2) the "Required Sections Reference" clause in the
  `spec-writing-standard` row of `## Affected Files` (line 339). `## Architecture Review` (lines 127–254)
  still matches, item for item, what the GATE-WRITE re-run recorded: 4 alternatives A1–A4 each with Pro and
  Con, sibling scan naming RULE-007/008/009/010/011, exactly 8 numbered failure modes with the count stated
  identically at lines 206 and 254, Decision carrying 7,172 / 41.8%. Frontmatter unchanged: `type: RULE`,
  `tags: [infra, cli]`.
- **Independent architecture validation (conditional): N/A** — the conditional does not fire.
  `spec-workflow.md` > New-Surface Architecture Placement (lines 80–107) scopes to a new package, app, or
  presentation/interface surface, or a reclassified layer / product-family boundary, and its clauses (mirror
  an analogous existing layer + state the product-family classification; reuse at the shared CONTRACT/CORE
  level rather than depending on a sibling PRODUCT) are code-architecture tests. This spec adds no package
  and no app: it adds one harness scan beside ~40 siblings in `scripts/harness/` (the only location such
  scans have), writes instances of the `docs/design/` type `RULE-009` already defined, and adds one optional
  SPEC section. The boundary it reclassifies is a documentation-content boundary with no dependency edges and
  no product family, leaving clause (2) with no possible subject. No `proposal-reviewer` /
  `architecture-auditor` entry is therefore required, and none is present. Reached independently from the
  rule text; it agrees with the GATE-WRITE runs.

**NON-COMPLIANCE trigger checked (implementation work started before this gate): not triggered.** Every row
of `## Affected Files` was probed: `scripts/harness/check-spec-whitebox-leakage.mjs`,
`scripts/harness/__tests__/spec-whitebox-leakage.test.mjs`, `packages/agent-cli/docs/design/`,
`packages/agent-framework/docs/design/` and `.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md` do not exist; `shared.mjs` holds no
`SPEC_REQUIRED_SECTIONS` constant and `cleanup-drift.mjs:13` still carries its own 8-entry copy;
`rg "User-Facing Contract"` over the skill, template and `agent-cli/docs/SPEC.md` → no match; `rg "파급"`
over `design-doc-authoring/SKILL.md` → no match; `rg "New or changed externally observable behavior"` over
`spec-workflow.md` → no match; `run-all-scans.mjs` registers no whitebox scan. `git status` shows three
unrelated modified files (`.agents/evals/lessons/auto-lessons.md`, `.agents/evals/lessons/weekly-digest.md`,
`.github/PULL_REQUEST_TEMPLATE.md`); the PR-template diff was inspected and rewrites the PR form, unrelated
to this item.

**Third GATE-WRITE run not required — checked, not assumed.** Neither `gate-catalogue.md` nor
`backlog-pipeline` mandates re-running a passed gate after a post-PASS edit (the pipeline's re-run
anti-pattern covers FAIL only). The two disclosed edits were nevertheless re-checked against every
GATE-WRITE criterion they could touch: Completion Criteria still 16 `TC-N`-prefixed items and `## Test Plan`
still 16 rows, TC-01…TC-16 on both sides; TC-12 remains command form with numeric thresholds; no banned
phrasing in the body; and no stated figure moved — 7,172 / 41.8% / 3,487 / ≤3,600 / ≤30% all stand as the
re-run verified them. No GATE-WRITE criterion is disturbed, so the skipped re-run is not a bypass.

**Correction to the GATE-WRITE re-run's note †.** The five optional standard sections _are_ enumerated in
the repository, at `.agents/skills/spec-writing-standard/SKILL.md` lines 46–51 (Mode A step 3:
Plugin/Hook Contract, Event Architecture, State Lifecycle, Dependencies, Configuration). They are absent
from that file's `## Required Sections Reference` table (lines 134–148), which lists the 9 required sections
only — the gap the `## Affected Files` row now records. The re-run's 7,586-vs-7,172 measurement and its
constant-offset reasoning are unaffected; only its "enumerated nowhere" wording is corrected here.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-16

**Status upgrade:** approved → in-progress

**Ordering check:** prior gate `GATE-APPROVAL` shows **PASS** in this log (`[GATE-APPROVAL] — ✅ PASS |
2026-08-16`, immediately above). Input state matches `gate-catalogue.md` > Prior-gate map: frontmatter
`status: approved` (line 2) and the file sits at `.agents/spec-docs/todo/`, the folder
`spec-workflow.md` > Spec-Document Status and Lifecycle Folders (line 162) maps to `approved`.
`find .agents -name "RULE-013*"` returns exactly two paths — this document and `.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md`
— so no stale copy remains in `draft/` or `backlog/`.

**Criterion 1 — `.agents/tasks/<ID>.md` has been created:** met. `.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md` exists
(154 lines, untracked), frontmatter `status: todo` / `created: 2026-08-16` / `depends_on: []`, and line 13
back-links to this spec document as its Plan. Its `## Recommendation Gate — WU-A` (line 133) carries
`REVIEW VERDICT: ENDORSE | 2026-08-16 | proposal-reviewer (revision 1)` — read in the file, not taken from
the dispatch note.

**Criterion 2 — tasks file path recorded in `## Tasks`:** met. Line 454 records
``[`.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md`](../../tasks/RULE-013-blackbox-whitebox-doc-boundary.md)``; the relative link resolves from
`.agents/spec-docs/todo/` to the existing file. The section's task count claim was checked and holds:
25 tasks total, WU-A 19 (T-01…T-19), WU-B 6 (T-20…T-25).

**Criterion 3 — one task per TC-N (checked by what each task delivers, not by its parenthetical tag):**
met, **16/16**. TC-01→T-01 (placement section + `최종 사용자 대상 계약` row, both `rg` targets);
TC-02→T-02 (link-only, no body copy); TC-03→T-14 (the literal mandate wording); TC-04→T-09 (the scan)

- T-10 (pre-recovery fixture pinning the 2-finding result); TC-05→T-25; TC-06→T-21; TC-07→T-20;
  TC-08→T-20+T-21 (the files that make the count ≥3); TC-09→T-22; TC-10→T-23; TC-11→T-21;
  TC-12→T-24 (with T-18 re-deriving the basis); TC-13→T-19 (`harness:scan` exit 0), enabled by T-12/T-13;
  TC-14→T-03 (skill) + T-04 (template), with the criterion's third assertion
  (`rg "^## User-Facing Contract" packages/agent-cli/docs/SPEC.md`) delivered by T-21; TC-15→T-06+T-07;
  TC-16→T-11. Three tags were found to be association rather than delivery, none of which leaves a TC
  uncovered: T-18 `(TC-05, TC-12)` re-derives the baseline and delivers neither (T-25/T-24 do); T-19
  `(TC-11, …)` does not deliver TC-11 (T-21 does) but does deliver TC-13; T-22 `(TC-08, …)` delivers the
  MUST-5-section content of TC-09, while TC-08's file count comes from T-20/T-21.

**Criterion 4 — tasks file carries a `## Test Plan` (or `Testing`/`검증`) of ≥50 chars:** met.
`## Test Plan` at line 119, body measured at **918 characters** (≥50). Note on the criterion's stated
rationale [AF-24]: `scripts/harness/scan-test-plan.mjs` deliberately **excludes** `.agents/tasks` from
`SCAN_DIRS` (lines 48–70 document why), so a missing section there would not fail `harness:scan` today;
the criterion is met on its own terms regardless. The scan was run: exit 0,
`::examined:: 29 planning documents`, and `.agents/spec-docs/todo` is inside its live scope, so this
document was among those checked.

**NON-COMPLIANCE trigger checked — "implementation commits exist but no tasks file was created": not
triggered, in either direction.** No implementation has started. Every `## Affected Files` row was
probed: `scripts/harness/check-spec-whitebox-leakage.mjs` and
`scripts/harness/__tests__/spec-whitebox-leakage.test.mjs` absent; `packages/agent-cli/docs/design/` and
`packages/agent-framework/docs/design/` absent (`find packages apps -path "*/docs/design/*" -name "*.md"`
→ **0** repo-wide); `rg "파급" design-doc-authoring/SKILL.md` → exit 1;
`rg "design-doc-authoring" spec-writing-standard/SKILL.md` → exit 1;
`rg "New or changed externally observable behavior" spec-workflow.md` → exit 1;
`rg "User-Facing Contract"` over the skill, the template and `agent-cli/docs/SPEC.md` → exit 1;
`shared.mjs` holds no `SPEC_REQUIRED_SECTIONS` while `cleanup-drift.mjs:13` still carries its own 8-entry
copy missing `Class Contract Registry`; `check-document-authority.mjs::isDesignDoc()` (line 68) still
matches only `.design/`, `docs/plans/*-design.md`, `docs/superpowers/*design*.md`;
`run-all-scans.mjs` registers no whitebox scan. `git log --all --grep="RULE-013"` → empty; `git status`
shows both RULE-013 files as untracked and the only other changes are three unrelated files.

**Post-approval edits to this document — verified independently, approval NOT invalidated.**
`## Architecture Review` still spans lines **127–254** and every anchor the GATE-APPROVAL entry cited is
at the same line: A1–A4 at 155/161/167/177, sibling scan naming RULE-007…011 at 249, `총 8건` at 206,
`실패 모드 8건` at 254, and exactly 8 numbered failure modes between them. Frontmatter unchanged
(`type: RULE`, `tags: [infra, cli]`). The line-shift arithmetic accounts for the disclosed edits and
admits no undisclosed one: the `### Work Unit 분할` block occupies lines 262–288 (**27 lines**) and the
three amended `## Affected Files` rows are lines 374–376 (**3 lines**); the `spec-writing-standard` row
moved 339 → 366 (**+27**, i.e. before the new rows) and the TC-12 metric-basis line moved 381 → 411
(**+30 = 27 + 3**). No shift occurs at or above line 254. The document is untracked in git, so no diff
exists; this is the strongest independent check available and it is consistent. Judgement: the
catalogue's GATE-APPROVAL criterion protects `## Architecture Review` and frontmatter `type`/`tags` only
— neither was touched — so neither the work-unit split, the scope amendment, nor the filled-in `## Tasks`
invalidates the approval.

**Observations recorded — none of them a GATE-IMPLEMENT criterion, all of them decidable at a later
gate:**

1. _Work-unit partition._ The spec's TC↔WU partition (lines 286–287) is **complete and disjoint** — the
   union of WU-A {01,02,03,04,13,14,15,16} and WU-B {05,06,07,08,09,10,11,12} is TC-01…TC-16 with no
   overlap. The task file's WU assignment does **not** fully agree: WU-A's T-18 and T-19 carry WU-B TCs
   (05, 11, 12) as tags. Checked and found harmless — those are association tags; delivery of TC-05/11/12
   remains in WU-B. The converse is a real defect: **TC-14 is assigned to WU-A alone, but its third
   assertion can only be satisfied by T-21, which is in WU-B**, so WU-A cannot close TC-14.
2. _Scope amendment provenance._ The three added `## Affected Files` rows are marked `범위 확대(2026-08-16
승인)`. That approval is a statement about the orchestrator's conversation; no repository artifact can
   corroborate or contradict it, and this guardian did not verify it. Relatedly, `### Affected Scope`
   inside `## Architecture Review` (5 rules/skills, 5 scripts, 2 pilots) now under-lists the amended
   table — correctly so, since amending it would have tripped the GATE-APPROVAL criterion. Flagged so the
   divergence is not later read as a contradiction.
3. _TC-15 vs T-06._ TC-15 asserts `import('./scripts/harness/shared.mjs')` exposes
   `SPEC_REQUIRED_SECTIONS` with `.length === 9`, while T-06 forbids a hard-coded array in `shared.mjs`
   (parse the skill's table, fail-closed). Both hold only if `shared.mjs` continues to export that name as
   a **derived** value. Premise re-verified as still unfixed: `cleanup-drift.mjs:13` = 8 entries,
   `Class Contract Registry` missing; `shared.mjs` = no such constant.

### WU-B 구현 — 2026-08-16

WU-A 병합(PR #1741 → develop `96728940c`, PR #1742 → main `cca410e39`) 이후 착수.
브랜치 `feat/rule-013-wu-b-pilot-extraction` (`origin/develop`에서 분기).

**Recommendation Gate에서 REVISE를 받고 접은 내용 (`proposal-reviewer`):**

| 지적                                                                     | 처리                                                                                                      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| TC-05·TC-12가 **추출 없이 개명만으로 통과 가능** — 스스로 vacuous green  | TC-05를 절대 잔여량(≤150줄)으로 교체, TC-12를 수용 기준에서 **관측 기록으로 강등**                        |
| TC-06·TC-07의 "SPEC ≤700줄"이 **도달 불가**이며 계약을 design으로 밀어냄 | 두 기준 폐기. TC-06은 잔류 헤딩의 표준 정규화(`isStandardSpecSection()`), TC-07은 분류표 완결성으로 교체  |
| P2 — `## Public API`(665줄)는 whitebox가 아니라 공개 계약                | 전제 철회. `Public API Surface`로 흡수하는 것이 맞고, design 이동은 오답                                  |
| P3 — `agent-cli`의 사용자 대면 섹션 다수를 whitebox로 오분류             | 전제 철회. `agent-cli`의 consumer는 **터미널 앞의 사람**이므로 키 바인딩·시각 문법·슬래시 명령은 계약이다 |
| P4 — `## Feature Details`는 횡단이며 **이미 드리프트**했다               | design 이동이 아니라 `delete-and-link`. design으로 옮기면 드리프트를 새 파일명 아래 보존할 뿐             |
| P5 — `document-authority` 백스톱이 이 PR에서 무력                        | 백스톱 주장 철회                                                                                          |
| **권고 1 — 분류표를 먼저 만들어라. 그것이 리뷰 대상이고 diff는 결과다**  | `## Appendix — WU-B per-section classification` 신설 — 두 파일럿 **62개 섹션 전수**                       |

**분류 중 발견 — `agent-framework/docs/SPEC.md`는 문서 두 벌이 이어붙어 있다.** L3–694가 표준 섹션
SPEC이고 L695의 `## Overview`부터 1,955줄짜리 별개 문서가 재시작한다. 문서가 스스로 적고 있다 —
`## Architecture Overview`(L63) 본문의 _"See the 'Architecture' section below"_, 그리고
`## Public API Surface`(L161, 표) ↔ `## Public API`(L1342, 서술)가 같은 주제의 두 판본으로 1,181줄
떨어져 있다. 배치 기준이 만든 결함이 아니고 배치 기준이 고치지도 못한다 — 두 서술을 대조해 **어느 쪽이
현행인지 코드로 판정**해야 하는 별건이며 2,649줄 SPEC 재작성 규모(소프트 상한의 4배)다.
`DOCS-025`로 분리 제기하고 **WU-B는 `agent-cli` 파일럿 한 건으로 좁혔다.** 분류표의 Pilot 2는
`DOCS-025`의 출발 분석으로 남는다.

**산출:**

- `packages/agent-cli/docs/SPEC.md` — `##` 34개 → 표준 12개, 비표준 헤딩 **0**, 1,939 → 1,731줄
- `packages/agent-cli/docs/design/` **6건**(409줄) — `composition` · `session-ownership` ·
  `command-registry` · `internal-structure` · `message-architecture` · `subagent-wiring`
- `.agents/spec-docs/draft/DOCS-025-...md` 신규 제기
- 11 files changed, +1,608 / −1,092

**검증 (전부 실행함):**

| 항목                | 결과                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm harness:scan` | **111 passed, 2 skipped, 0 failed**                                                                                                      |
| 내용 보존           | 구 SPEC의 비공백 줄(헤딩 마커 제거) 다중집합 vs 신 SPEC + design 6건 → **본문 유실 0줄**. 사라진 6개는 의도적으로 해체한 헤딩 **제목**뿐 |
| TC-05               | `agent-cli` 표준 섹션 밖 **0줄** (기준 ≤150)                                                                                             |
| TC-06               | 비표준 `##` 헤딩 **0개**                                                                                                                 |
| TC-09               | `check-design-doc-completeness.mjs` exit 0, 경고 0                                                                                       |
| TC-12 (관측)        | 6,675줄/38.4% → **4,967줄/28.9%** (−1,708줄, −9.5pp), 임계 초과 2건 → **1건**                                                            |
| 단위 테스트         | `spec-sections` 14/14, `check-spec-whitebox-leakage` 8/8 (vitest)                                                                        |

**같은 실행에서 고친 스캔 4건** — 재구성이 드러낸 것들이며 조용히 넘기지 않았다:

1. `background-workspace` — 배경 작업 수명주기 경계 문단이 design으로 넘어갔다. **스캔이 옳다**:
   소유권 경계는 계약이므로 `## Boundaries`로 복귀시켰다
2. `spec-doc-frontmatter` · `test-plans` · `spec-research` — 분류표를 별도 파일로
   `.agents/spec-docs/active/`에 두어 세 스캔이 그것을 spec 문서로 취급했다. 근본 원인이 하나이므로
   Plan 문서의 부록으로 접어 해소했다(파일 삭제, 참조 재지정)

**관측 — 수용 기준 아님:** `pnpm harness:scan -- --only <name>`의 `--only`가 필터링하지 않고 전체를
돌린다. 이 항목의 범위 밖이라 고치지 않았고, 기록만 남긴다.

### WU-B Recommendation Gate Round 2 — 2026-08-16

`proposal-reviewer` 재심사 결과 다시 **REVISE**. clean 3건(범위 축소의 정당성, design doc 실질성,
내용 무손실 — 심사자가 `comm -23`으로 독립 재현), 불통과 2건. **둘 다 맞았고 직접 검증한 뒤 접었다.**

**1. TC-05의 "0"은 허상이었다 — 같은 실패의 세 번째 반복.**
`check-spec-whitebox-leakage.mjs:62`가 `/^##\s+/`로 **`##`만** 마크한다. 비표준 `##`을 표준 `##`
아래 `###`로 내리면 한 줄도 옮기지 않고 잔여량이 0이 된다. 이 PR이 정확히 그렇게 했다 — 비표준 `##`
20개 강등, 88.1% → **0.0%**. 그리고 TC-06("잔류 헤딩이 전부 표준으로 정규화")을 "TC-05의 구멍을
닫는다"고 적었던 것은 거꾸로였다. 20개를 표준 헤딩 하나 아래로 모으는 강등이 **바로 TC-06을 만족시키는
방법**이다. TC-06은 봉인이 아니라 구멍이었다.

이 문서는 같은 진단을 이미 내려놓고("지표는 배치가 아니라 헤딩 적합성을 잰다") TC-12만 강등하고
TC-05·TC-06은 같은 지표 위에 남겨두었다. 처리:

- **TC-05를 지표에서 분리** — `scripts/harness/verify-doc-split-preservation.mjs`(신규)로 무손실을
  단정하고, `packages/agent-cli/docs/design/*.md` 본문 줄 합계 ≥200으로 회수량을 단정한다. 강등은
  둘 다 만족시킬 수 없다. 세 번의 정정 중 **처음으로 임계값이 아니라 대상을 바꿨다**
- **TC-06을 관측 기록으로 강등**
- **지표 결함을 `HARNESS-052` G8로 등재**(second axis, sub-shape A: 이름이 약속한 것과 다른 것을
  재는 검사)하고, 스캔 헤더 주석에 사각지대를 명시했다

**2. 계약 3건이 SPEC 밖으로 나갔고, whitebox 5건이 표준 헤딩 아래 세탁됐다.** 1차 분류가 `##` 단위로만
판정하고 혼합 `###`은 덩치가 큰 쪽으로 통째로 보낸 결과다. `rg`로 8건 전부 확인했다.

- **복귀:** 스킬 변수 치환 토큰(`$ARGUMENTS`·`${PROJECT_DIR}` …)과 `` !`command` `` → `Extension Points`;
  `/background` 하위명령·인자 표와 "raw task ID 노출 금지" → `User-Facing Contract`;
  `transports` settings 키 → `Configuration`
- **추출:** `React.memo`·`Message Windowing`·`Tool State Cleanup` → `design/message-architecture.md`;
  `Command Module Composition` → `design/composition.md`(`StatusBar Display` 아래 있던 것도 바로잡음);
  `Testing Requirements` → SPEC `## Test Strategy`

가장 날카로운 지적은 첫 두 건이다. 1차 분류는 `### Skill Frontmatter Schema`를 "사용자가 그것에 맞춰
`SKILL.md`를 작성하므로 계약"이라며 남겨두고, **같은 사용자 작성 파일의 본문 문법**은 design으로 보냈다.
frontmatter는 계약인데 본문은 아니라는 것은 경계가 아니라 모순이다.

**부수 정정:** `design/composition.md`가 존재하지 않는 `check-composition-neutrality.mjs`를 인용했다
(실제 `scan-composition-neutrality.mjs`) — 새 문서가 첫날부터 깨진 참조를 싣는 것은 A3가 막으려던 바로
그것이라 즉시 고쳤다. Test Plan의 TC-05/06/07/12/15 행이 폐기된 기준을 가리키던 것도 갱신했다.

**별건으로 남긴 것:** `## User-Facing Contract`가 1,017줄·4단 헤딩이다. 제품 셸의 계약이 곧 UX인
경우 슬롯 하나로는 부족할 수 있다(`Invocation Surface` vs `Terminal Display Contract` 분리, 또는 하위
구조 규정). 표준 섹션 목록의 문제이지 이 파일럿의 문제가 아니므로 접지 않는다. 파일럿은 `agent-cli`를
"whitebox 사이에서 계약을 찾을 수 없음"에서 "범주로는 찾히나 그 안에서 길을 잃음"으로 옮겼다 — 진전이지
종착점은 아니다.

### WU-B Recommendation Gate Round 3 — 2026-08-16

세 번째 **REVISE**. 방향은 승인받았고("지표를 재조정하는 대신 떠난 것이 옳은 세 번째 정정"), 세 건이
불통과. 셋 다 검증하고 접었다.

**1. TC-05가 실행 불가능한 상태로 기록돼 있었다.** `<분할 직전 ref>` 같은 자리표시자 셋에
`--allowances`도 빠져 있어 **문자 그대로 실행하면 exit 1**이었다. 그리고 허용 11건은
`rg -c "allow-lost" .agents/` → **0**, 즉 저장소 어디에도 없었다. 기록된 기준과 실제로 돌린 명령이
다른 것은 이 백로그가 다루는 바로 그 병 — 일하지 않고 통과하는 기준 — 의 다른 형태다.

- ref를 `96728940c`로 고정하고 `--target` 7개를 전부 적은 **복사-실행 가능한 명령**으로 교체했다.
  문서에서 그 블록을 그대로 뽑아 실행해 exit 0을 확인했다
- 허용 목록을 커밋되는 `packages/agent-cli/docs/design/.split-allowances.json`으로 옮기고,
  **13건 중 11건을 도구가 검증하게 했다** — 개명 9건은 `survivesAs`가 실제로 목적지에 있는지,
  delete-and-link 2건은 `deletedAndLinkedTo`가 가리키는 소유 문서로의 링크가 실재하는지.
  나머지 2건(줄바꿈이 바뀐 문장)만 서면 사유로 받는다. 사유 없는 허용, 존재하지 않는 대체 문자열,
  없는 허용 파일 — 전부 red로 재현 확인했다

**2. §23의 `delete-and-link`가 실행되지 않았다 — 그리고 결론 문장이 거짓이었다.** 분류표는
`agent-framework` 계약의 재서술을 `delete-and-link`로 처분했는데, 실제 diff는 그것을
`design/subagent-wiring.md`로 **옮겼다**. 축자 중복은 0이지만 두 문단이 소유 패키지의 계약을
**말바꿈**으로 서술하고 있었다 — 사본보다 조용히 드리프트하는 형태다. 이 문서가 Pilot 2의
`## Feature Details`에 대해 "design으로 옮기면 드리프트를 새 파일명 아래 보존할 뿐"이라고 적어둔
바로 그 오류를, Pilot 1이 `delete-and-link`로 분류한 유일한 행에서 저질렀다.

결정적으로, **내 도구가 이미 그 증거를 내놓고 있었다** — 두 라운드 내내 "유실 0"이라고 보고했고, 그것은
`delete-and-link`가 아무것도 삭제하지 않았다는 뜻이다. 결론 문장의 "≈20줄 delete-and-link"는 실행된
적 없는 추정치였고 도구가 그것을 반증하고 있었는데 대조하지 않았다. 두 문단을 삭제하고 링크로 대체했으며,
결론을 실측("2개 문단")으로 정정하고 추정치가 미실행이었음을 명기했다.

**3. §11 split 행이 부록과 모순이었다.** 같은 내용(`Variable Substitution`)에 대해 표는
`design/command-registry.md`, 부록은 `Extension Points`라고 적고 있었다. 행을 둘로 쪼개 정정했다.

**후속으로 분리 제기(드롭 아님, 심사자 요구):**

- **`HARNESS-094`** — 분류표를 검사하는 것이 사람 눈뿐이다. 위 결함 2·3은 **표를 파싱해 처분별로
  단정하는 스캔 하나면 자동으로 걸렸을 것**이다. TC-07은 완결성만 요구하고 정합성은 요구하지 않는다
- **`RULE-014`** — `## User-Facing Contract`가 1,017줄·4단 헤딩(문서의 58%)으로 섹션이 아니라
  컨테이너다. 표준 섹션 목록이 라이브러리 패키지를 전제로 설계된 결과이며, 파일럿의 결함이 아니라
  목록의 결함이다

### WU-B Recommendation Gate Round 4 — 2026-08-16

네 번째 **REVISE**. 설계는 승인받았다 — "Architecture-placement verdict: correct", "설계 관점에서는
승인하겠다". 남은 넷은 전부 **증거 기록의 결함**이고, 그것이 이 항목이 없애려는 두 실패 모드가
`RULE-013` 자신의 기록 안에 남아 있다는 뜻이었다.

**1. TC-05의 펜스가 깨져 `format-check`이 red였다.** 닫는 펜스가 여는 펜스보다 8칸 깊어 블록이 닫히지
않았고, 코드 블록이 자기 뒤의 설명 문단까지 삼켰다. 변경 18파일 중 유일하게 prettier가 거부했다.
**내 커밋 메시지의 검증 목록에 `format-check`이 없었다** — 기록된 검증이 실제로 통치하는 검증이 아닌 것,
바로 3라운드에서 고친 결함과 같은 형태다. 명령 블록을 체크리스트 밖 `### TC-05 검증 명령`으로 분리해
구조적으로 안정시켰다(리스트 안의 펜스는 들여쓰기가 깨지기 쉽다). 문서에서 추출해 실행 → exit 0.

**2. allowance entry 12의 소유자가 자기 사유와 모순이었고, 형제 항목의 링크에 얹혀 통과했다.**
`deletedAndLinkedTo`는 `agent-framework`를 가리키는데 사유는 `agent-command`를 말하고 있었다. 확인해
보니 더 근본적인 오분류였다 — 그 문단이 담은 사실은 **`agent-cli` 자신의 `## Boundaries`에 이미 있었다**
(기준 ref L52: _"Does NOT own user-local command behavior — `@robota-sdk/agent-command` owns the …"_).
cross-package `delete-and-link`가 아니라 **in-package 중복**이었다. 재분류하고 근거를 사유에 적었으며,
두 문단을 모두 `agent-framework` 재서술로 귀속시키던 §23 표 행도 정정했다.

**3. 도구에 구멍이 셋 남아 있었다.** 셋 다 재현하고 막았다:

- **링크가 항목에 묶여 있지 않았다** — `destinations.some(...)`이라 소유자를 명시한 **모든** 항목이
  링크 하나로 만족됐다. entry 12가 정확히 그렇게 통과했다. 이제 항목마다 별개의 링크 발생을 요구한다
- **`survivesAs`가 원본에 이미 있어도 통과했다** — 대체가 아닌 줄로 개명이 "검증"된다. 원본에 존재하면
  거부한다(현재 9건은 전부 통과)
- **패키지 세그먼트 없는 경로가 여전히 통했다** — `docs/SPEC.md`는 모든 패키지의 SPEC에 매치된다.
  3라운드에서 고쳤다고 한 버그가 다른 입력으로 살아 있었다. 소유 경로는 `packages/`·`apps/` 앵커를
  요구한다

남은 두 구멍(사용되지 않은 stale allowance가 조용히 통과, 중복 줄의 다중도 미반영)은 헤더 주석에
**known and deferred**로 명시했다.

**4. TC-12가 추정치를 적고 `[x]` 처리돼 있었다.** "기록한다"고 써놓은 자리에 실행하지 않은 추정
(≈6,185줄 / 35.6%)을 적었고, 실측(4,967 / 28.9%)과 **1,218줄** 어긋났다. 기록된 수치는 그것을 만든
실행에서 나와야 한다는 이 백로그의 논지를 정면으로 어긴 것이다. 두 끝점을 다시 실행해 표로 기록하고,
`agent-cli`의 1,708 → 0 중 실제 이동은 ~195줄뿐이라는 경고를 함께 적었다. Problem §2의
6,654 / 38.5%도 TC-12와 같은 기준(6,675 / 38.4%)으로 맞췄다.

**verify-like-ci는 이미 이것을 잡고 있었는데 내가 exit code를 잘못 읽었다.** 백그라운드 실행을
`cmd > log 2>&1; echo exit=$?; tail log`로 감쌌더니 알림이 보고한 exit 0은 마지막 `tail`의 것이었다.
로그 안에는 `FAIL — 2 of 12 stage(s) failed: format-check, harness-self-test`가 있었다. **성공을 관측된
효과가 아니라 exit code로 판정하지 말 것** — `.agents/memory/bound-every-wait-and-solve-it-yourself.md`에
적어둔 항목을 그대로 반복했다. `harness-self-test` 쪽은 재구성으로 `spec-missing-sections`가 47 → 46이
된 것이라 지시대로 같은 변경에서 `--write-baseline`으로 재freeze했다.
