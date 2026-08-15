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

2. **그 내용은 `SPEC.md` 안에 있다.** 워크스페이스 패키지 `SPEC.md` **86개** 총 **17,270줄** 중
   표준 섹션(필수 9 + 선택 6) **밖**의 내용이 **6,654줄 = 38.5%**.

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

| Work unit            | 범위                 | 예상 규모        | 성격                                                          |
| -------------------- | -------------------- | ---------------- | ------------------------------------------------------------- |
| **WU-A** 계약과 강제 | Phase 1 · 1b · 3 · 4 | ~11파일, 상한 내 | 규칙 + 그 강제 + 배선 — PR Unit Rule이 "ONE PR"로 명시한 형태 |
| **WU-B** 파일럿 추출 | Phase 2              | ~3,455줄 이동    | 순수 이동 전용 PR. 수용 기준은 "스캔이 green으로 전환"        |

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

- [ ] TC-01: 배치 기준이 owner 문서에 존재 —
      `rg -q "consumer-impact test" .agents/skills/design-doc-authoring/SKILL.md` → exit 0, 그리고
      경계 사례 표에 최종 사용자 계약 행이 존재
      (`rg -q "End-user-facing contract" .agents/skills/design-doc-authoring/SKILL.md` → exit 0).
      **단정 문자열은 영어다** — `naming-style.md` > Language Policy가 하네스 자산을 포함한 그 외
      전부를 영어로 규정하므로, 한국어 토큰(`파급`)을 단정하던 초안 문구는 산출물이 준수해야 할
      규칙과 어긋났다. 검증 대상은 기준의 존재이지 그것을 적은 언어가 아니다
- [ ] TC-02: `rg -c "design-doc-authoring" .agents/skills/spec-writing-standard/SKILL.md` → 1 이상
      (배치 기준 owner로의 링크가 존재하고, 기준 본문 복사본은 없음)
- [ ] TC-03: `rg "New or changed externally observable behavior" .agents/rules/spec-workflow.md` → exit 0
- [ ] TC-04: `node scripts/harness/check-spec-whitebox-leakage.mjs` 가 Phase 2 **이전** 스냅샷에서
      `agent-framework`·`agent-cli` 정확히 2건을 finding으로 보고 (단위 테스트 픽스처로 고정)
- [ ] TC-05: `node scripts/harness/check-spec-whitebox-leakage.mjs` → Phase 2 완료 후 exit 0 (finding 0건)
- [ ] TC-06: `wc -l < packages/agent-cli/docs/SPEC.md` → 700 이하
- [ ] TC-07: `wc -l < packages/agent-framework/docs/SPEC.md` → 700 이하
- [ ] TC-08: `find packages/agent-cli/docs/design packages/agent-framework/docs/design -name "*.md" | wc -l` → 3 이상
- [ ] TC-09: `node scripts/harness/check-design-doc-completeness.mjs` → exit 0 (신규 design doc이
      MUST 5섹션을 전부 충족, 더 이상 vacuous 통과가 아님)
- [ ] TC-10: 양방향 링크 — 각 신규 design doc에서 `rg "SPEC\.md" <design-doc>` exit 0 이고, 각 파일럿
      SPEC.md에서 `rg "docs/design/" <spec>` exit 0
- [ ] TC-11: `rg "Keyboard Controls" packages/agent-cli/docs/SPEC.md` → exit 0 (최종 사용자 계약이
      design으로 잘못 이동하지 않았음)
- [ ] TC-12: 전체 유출량 회귀 — 표준 섹션 밖 **절대 줄 수 7,172 → 3,600 이하** AND **비율 41.8% →
      30% 이하** (집계 스크립트 출력, 중첩 포함 글롭 기준). 목표치 산출 근거: 파일럿 2건이 완전
      회수되면 이동량 ≈ 1,975 + 1,710 = 3,685줄, 그중 cli 사용자 계약 ≈ 230줄은 이동이 아니라
      Phase 1b 표준화로 집계에서 빠지므로 design 이관분 ≈ 3,455줄. 잔여 표준 밖 ≈ 3,487줄 /
      새 총량 ≈ 13,684줄 = **25.5%**. 파일럿 2건만으로 20%에는 도달할 수 없다.
      **이 임계는 두 번 정정됐다** — 초안의 20%는 산술 오류였고(실패 모드 4), 1차 정정치 ≤3,400줄은
      최상위 글롭 기준이라 완전 corpus에서는 3,487 > 3,400으로 다시 미달이었다(실패 모드 8).
      최종치는 87개 파일 전수 기준이며, TC-02/TC-05의 스캔과 동일한 글롭을 쓴다.
      **집계 기준(metric basis)은 Phase 3에서 `shared.mjs`에 고정하는 SSOT 상수 — 필수 9 + 선택 6
      (`User-Facing Contract` 포함) — 이며, TC-12·TC-02·TC-05·TC-16이 모두 이 상수를 쓴다.**
      기준을 명시하는 이유는 임계가 기준에 의존하기 때문이다: 필수 9만으로 집계하면 잔여가
      ≈3,852줄이 되어 ≤3,600을 넘고, 선택 6 없이 9+5로 집계하면 cli 사용자 계약 ≈230줄이 표준 밖에
      남아 ≈3,717줄로 역시 넘는다. 기준선 7,172줄은 Phase 1b 이전이라 `## User-Facing Contract`
      헤딩을 가진 파일이 하나도 없어 9+5와 9+6이 동일값을 내므로, 기준 변경의 영향을 받지 않는다.
- [ ] TC-13: `pnpm harness:scan` → exit 0
- [ ] TC-16: 중첩 워크스페이스 패키지가 스캔 범위에 포함됨 — `check-spec-whitebox-leakage.mjs --all`
      출력에 `packages/dag-nodes/` 항목이 **20건** 나타난다. **총 파일 수를 단정하지 않는다**: 구현 중
      확인된 대로 `packages/dag-nodes/docs/SPEC.md`는 `package.json`이 없는 컨테이너 디렉터리의
      문서라 워크스페이스 패키지가 아니며, 초안이 근거로 삼은 `find` 기반 87은 그것을 잘못 포함한
      숫자였다(SSOT 열거기 기준 86). 막아야 할 회귀는 **중첩 그룹 누락**이지 특정 총계가 아니다 —
      숫자 단정은 이 항목에서 네 번 틀렸다
- [ ] TC-14: `rg "User-Facing Contract" .agents/skills/spec-writing-standard/SKILL.md .agents/templates/spec-template.md`
      → 두 파일 모두 hit, 그리고 `rg "^## User-Facing Contract" packages/agent-cli/docs/SPEC.md` → exit 0
      (슬롯이 정의되고 파일럿에서 실제로 사용됨)
- [ ] TC-15: 표준 섹션 목록 SSOT — `rg -c "SPEC_REQUIRED_SECTIONS = \[" scripts/harness/cleanup-drift.mjs`
      → 0 (자체 복사본 제거됨) AND 단위 테스트가 파서 결과와 `spec-writing-standard/SKILL.md`의
      Required Sections Reference 표 사이의 **집합 동등성**을 단정한다. 길이 검사가 아니다 — 길이는
      이름이 하나 바뀌어도 통과하므로 이 항목이 고치려는 드리프트를 못 잡는다. 필수/선택은 **구별
      가능하게** 반환되어야 하고(`cleanup-drift`는 필수만, 유출 지표는 필수 ∪ 선택), 동등성 단정은
      **필수 표에 한정**한다. 표를 읽지 못하면 **fail-closed**(exit 1). `shared.mjs`에 하드코딩
      배열을 두지 않으므로 상수 길이를 단정하던 초안 문구는 폐기한다

## Test Plan

테스트 전략 도출: `type: RULE` → 단위 테스트. `tags: [infra, cli]` → CI 파이프라인 스모크 +
프로세스 스폰/stdout 단정. 문서·프로세스 백로그이므로 `manual` 대신 command-form / `rg` 패턴 /
`pnpm harness:*` 스모크를 기본으로 삼는다.

| TC-ID | Test Type | Tool / Approach                                                          | Notes                                                                             |
| ----- | --------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| TC-01 | command   | `rg` 패턴 2건 (`consumer-impact test`, `End-user-facing contract`)       | 배치 기준 + 사용자 계약 예외가 owner 문서에 존재                                  |
| TC-02 | command   | `rg` 링크 존재 + 기준 본문 미복제 확인                                   | Non-Duplication 확인                                                              |
| TC-03 | command   | `rg` mandate 행 문구                                                     | Phase 4 반영 여부                                                                 |
| TC-04 | unit      | `scripts/harness/__tests__/spec-whitebox-leakage.test.mjs` + 고정 픽스처 | 임계(≥300 AND ≥40%) 정확도. 오탐 픽스처(203/203, 210/210) 포함                    |
| TC-05 | CI smoke  | `node scripts/harness/check-spec-whitebox-leakage.mjs` exit code         | 회수 완료 판정                                                                    |
| TC-06 | command   | `wc -l`                                                                  | 계약 문서 크기 회귀                                                               |
| TC-07 | command   | `wc -l`                                                                  | 계약 문서 크기 회귀                                                               |
| TC-08 | command   | `find … \| wc -l`                                                        | design doc 실물 존재                                                              |
| TC-09 | CI smoke  | `node scripts/harness/check-design-doc-completeness.mjs` exit code       | vacuous green 해소 — 대상이 0이 아닌 상태에서 통과                                |
| TC-10 | command   | `rg` 양방향 링크                                                         | 발견 가능성                                                                       |
| TC-11 | command   | `rg`                                                                     | 최종 사용자 계약 잔류 회귀 방지                                                   |
| TC-12 | command   | 표준 섹션 밖 절대량·비율 집계 스크립트 stdout 단정                       | 기준선 7,172줄/41.8%(87개 전수). 목표 ≤3,600줄/≤30% — 파일럿 2건 범위의 산술 상한 |
| TC-13 | CI smoke  | `pnpm harness:scan` exit code                                            | 전체 하네스 무회귀                                                                |
| TC-14 | command   | `rg` 3건 (스킬·템플릿·파일럿 SPEC)                                       | `User-Facing Contract` 슬롯이 정의되고 실제 사용됨                                |
| TC-15 | unit      | `rg` 복사본 부재 + `node -e` 로 SSOT 상수 길이 9 단정                    | 표준 섹션 목록 3중 복제 방지 + 기존 8개 누락 교정                                 |
| TC-16 | CI smoke  | `--all` 출력의 `dag-nodes/` 항목 수 == 20 단정                           | 중첩 워크스페이스 패키지 누락 회귀 방지 (HARNESS-057 준수)                        |

## Tasks

- [x] [`.agents/tasks/RULE-013-blackbox-whitebox-doc-boundary.md`](../../tasks/RULE-013-blackbox-whitebox-doc-boundary.md) — 생성 완료 (2026-08-16). TC-01~TC-16
      전부에 대응하는 태스크 25건(WU-A 19 · WU-B 6)과 `## Test Plan` 포함.
- **WU-A Recommendation Gate:** `REVIEW VERDICT: ENDORSE` | 2026-08-16 | `proposal-reviewer`
  (revision 1 — 1차 `REVISE`의 네 findings를 접은 뒤 승인). 전문은 태스크 파일
  `## Recommendation Gate — WU-A`에 기록. `backlog-execution.md` > Recommendation Gate가 요구하는
  판정 기록이다.

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
