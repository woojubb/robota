# 아키텍처 컨포먼스 감사 — PRESET 레이어 설계 (2026-06-14)

> SUBJECT: 제안된 PRESET 설계(설계 제안서 + PRESET-001~008 백로그 8건). TRUTH: 레포 canonical 아키텍처 규칙
> (`.agents/project-structure.md`, `AGENTS.md` + `.agents/rules/*`, `version-management` skill, feedback 제약).
> 본 감사는 **제안된 설계의 아키텍처 결정/주장**을 canonical 규칙에 대조해 검증한다(기존 코드 감사가 아님).
> 방법론: architecture-conformance-audit + doc-claim-verification + conformance-finding-report (INFRA-002 스키마).

## 1. Method

### Verdict Vocabulary (doc-claim-verification)

| Verdict           | 의미                                               |
| ----------------- | -------------------------------------------------- |
| **HOLDS**         | 설계 주장이 canonical 규칙과 일치(확인 근거 인용). |
| **DRIFT**         | 방향은 맞으나 불완전/누락(보완 필요).              |
| **VIOLATION**     | 설계가 canonical 규칙을 위반.                      |
| **CONTRADICTION** | 설계 문서 내부 또는 설계와 authority 문서가 충돌.  |
| **STALE**         | 아직/더 이상 존재하지 않는 것을 참조.              |

### Severity (conformance-finding-report)

| Severity | 정의                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| **P0**   | 규칙 위반 또는 authority 충돌 — 경계/계약을 적극적으로 오도. 구현 전 반드시 수정. |
| **P1**   | 실질 drift: 미등록 의존 엣지, 누락된 계약/등재, 미반영 규칙 항목.                 |
| **P2**   | 경미: 부정확한 표현, 사소한 메타데이터 누락.                                      |

## 2. Mechanical Conformance Baseline

본 베이스라인은 현재 레포 상태(설계 미구현)에 대한 결정적 바닥값이다. PRESET 패키지는 아직 디스크에 없으므로
스캔은 기존 상태를 확인할 뿐 설계를 검증하지 않는다. 설계의 미래 위반 가능성은 §5 findings가 분석한다.

### `pnpm harness:conformance`

```
Architecture conformance gate (GATE-CONFORMANCE mechanical core)
  dependency-direction : ✅ pass
  workspace-package-name : ✅ pass

CONFORMANCE_JSON_BEGIN
{
  "dependencyDirection": "pass",
  "packageNameViolations": 0,
  "unknownPackageTokens": [],
  "conformant": true
}
CONFORMANCE_JSON_END
✅ Architecture conformance: PASS
```

### `pnpm harness:scan`

```
all 25 scans passed
(consistency, document-authority, commands, capability-placement, background-workspace,
 agent-server-boundary, sdk-public-surface, specs, spec-paths, workspace-refs, stub-markers,
 done-evidence, orphan-exports, deps, interface-imports, sdk-react-free, publish,
 release-governance, test-plans, coverage-scripts, file-size, build-contracts, dist,
 docs-structure, conformance)
```

**Reconciliation:** 두 베이스라인 모두 PASS. 보고할 기계적 위반 없음. PRESET 설계는 미구현이므로 기계적
floor는 "신규 패키지가 도입될 때 어떤 게이트가 작동할지"의 참조로만 쓰인다. `check-dependency-direction.mjs`는
엣지를 package.json에서 **동적으로** 도출하므로(하드코딩 allowlist 없음), 신규 엣지의 적법성은 구현 시점에
자동 검증된다 → AF-07 참조.

## 3. Dependency Graph Ground Truth

현재 관련 엣지(verbatim, package.json `dependencies`에서 도출):

- `agent-cli → { agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport }`
- `agent-command → { agent-core, agent-framework, agent-interface-transport }`
- `agent-framework → { agent-core, agent-executor, agent-interface-transport, agent-session, agent-tools }`
- agent-framework는 agent-command에 의존하지 **않는다**(명령 모듈이 framework 계약을 소비, 역방향 아님).

**위반 수: 0** (bidirectional 0, agent-core zero-dep 유지, pass-through re-export 0).

설계가 추가하려는 엣지:

| 엣지                             | 출처                      | 사이클? | 평가                                                                  |
| -------------------------------- | ------------------------- | ------- | --------------------------------------------------------------------- |
| `agent-preset → agent-framework` | PRESET-001 (설계 §5)      | No      | 적법 (단방향, framework가 하위)                                       |
| `agent-cli → agent-preset`       | PRESET-002 (설계 §5)      | No      | 적법 (cli가 최상위 합성 루트)                                         |
| `agent-cli → agent-framework`    | 이미 존재                 | No      | 적법 (composition-root 직접 호출)                                     |
| `agent-command → agent-preset`   | PRESET-006 (암묵, 미등재) | No      | **누락** — §5 엣지 목록·PRESET-006 Affected Files 양쪽에 없음 → AF-04 |

## 4. Per-Document / Per-Claim Verdict Summary

검증한 11개 아키텍처 주장/결정에 대한 verdict. (질문 번호 = 작업 지시 순번)

| #   | 주장/결정 (SUBJECT)                                                                             | Verdict   | Evidence (file:line / rule)                                                                                                                              | Finding |
| --- | ----------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | `agent-preset` 배치 + 엣지(`preset→framework`, `cli→preset`, `cli→framework`), 단방향·무사이클  | **HOLDS** | design §5 (L85-94); project-structure 의존방향(L18-20); 동적 엣지 도출(check-dependency-direction.mjs L13-15)                                            | —       |
| 2   | NO pass-through re-export (preset가 framework 감싸 재노출 안 함)                                | **HOLDS** | design §5 (L91-93 "감싸 재노출하지 않는다"); rule project-structure "no pass-through re-exports"; PRESET-001 결정 L40-43                                 | —       |
| 3   | agent-cli 얇은 껍데기(기능 로직 없음); composition-root 예외 올바르게 인용                      | **HOLDS** | design §5 레이어책임 (L96-117); PRESET-002 §Affected(L25-33); project-structure Composition-Root Exemption (L81-94)                                      | —       |
| 4   | `agent-preset`를 agent-core에 두지 않음(zero-dep 보존)                                          | **HOLDS** | design §5 체인(L79-82); PRESET-001 Alt-1 reject(L36-39); feedback_core_no_deps; project-structure L79                                                    | —       |
| 5   | Interface Package Rule: preset(콘텐츠+resolver)는 일반 패키지로 적절, IPreset 배치 일관         | **HOLDS** | PRESET-001 Alt-3 분석(L44-46) "구현+resolver라 interface-only 아님"; project-structure Interface Package Rule L65-79                                     | —       |
| 6   | Command Package Rule: PRESET-006이 `/preset`를 agent-command에 둠                               | **DRIFT** | PRESET-006 §Affected(L22-27); project-structure Command Package Rule L61-63 — 규칙엔 부합하나 신규 엣지 미등재                                           | AF-04   |
| 7   | NO 제품/벤더명: 식별자 generic(`autonomous-builder`), `reference`/`hermes`는 docs/description만 | **HOLDS** | PRESET-005 TC-06/TC-07(L136-137); design §3(L42-45), §6 각주(L188); naming-style Agent Identity L26-28; feedback_no_product_names                        | —       |
| 8   | version-management: 신규 패키지 = 현재 monorepo 버전(3.0.0-beta.74), fixed 그룹, SPEC.md        | **DRIFT** | PRESET-001 §Affected(L26-31) publish 등재만 언급, **버전/fixed-group 무명시**; version-management skill L11-13, L54-58                                   | AF-01   |
| 9   | SDK React-free / layered assembly / spec-before-code                                            | **HOLDS** | design §5(L79-117) core→...→cli 계층; agent-preset 순수 TS(React 무); spec-docs 8건 존재(코드 전 스펙); feedback_layered_assembly, feedback_sdk_no_react | —       |
| 10  | PRESET-008 effort 배선이 agent-framework + agent-provider 수정(cli 아님)                        | **HOLDS** | PRESET-008 §Affected(L94-102); "NOT agent-cli"(L44-46); design §6.1 row#3; layered-assembly 준수                                                         | —       |
| —   | PRESET-001: 신규 엣지를 `check-dependency-direction.mjs`에 "허용 등재" 필요(L30, L99)           | **DRIFT** | check-dependency-direction.mjs L23-58 — 엣지를 package.json에서 동적 도출, allowlist 없음 → "등재" 불필요                                                | AF-07   |
| —   | publish-registry / 비공개 여부: preset가 published인지 private인지 미결정                       | **DRIFT** | PRESET-001 §Affected(L31) "publish 등재"만; publish-registry.md Published vs Private 표 — preset 분류 미정                                               | AF-02   |
| —   | PRESET-006: `/preset` 명령이 agent-preset의 listPresets 소비 → agent-command 신규 의존 미등재   | **DRIFT** | PRESET-006 Affected Files(L57-61)에 package.json 의존 추가·SPEC 등재 누락; agent-command 현재 deps(미포함)                                               | AF-04   |
| —   | docs/SPEC.md: agent-preset SPEC 작성은 명시됨(규칙 충족)                                        | **HOLDS** | PRESET-001 §Affected(L27), Affected Files(L95) `packages/agent-preset/docs/SPEC.md` (NEW); AGENTS.md Owner Knowledge Policy                              | —       |

## 5. Findings

### P1 (구현 전 보완 권장 — 실질 drift/gap)

- **AF-01 [version-gap | P1]** — PRESET-001이 신규 `agent-preset` 패키지의 **시작 버전을 명시하지 않는다.**
  version-management skill(L11: "New packages start at the current monorepo version, not 0.1.0")에 따르면
  `3.0.0-beta.74`(= agent-core/package.json 현재값)로 시작하고 `.changeset/config.json`의 `fixed` 그룹에
  추가해야 한다. 현재 fixed 그룹(14개)에 `@robota-sdk/agent-preset` 없음. PRESET-001 §Affected/Affected Files는
  버전·fixed-group 등재를 전혀 다루지 않는다. _Fix:_ PRESET-001 Affected Files에 `package.json version = 3.0.0-beta.74`
  - `.changeset/config.json` fixed 그룹 추가를 명시하고, completion criterion(예: TC: fixed 그룹에 preset 포함 단언)을 추가.

- **AF-02 [publish-classification | P1]** — PRESET-001은 "publish-registry 등재"만 말하고 preset가
  **Published(beta) 인지 Private 인지 결정하지 않는다.** publish-registry.md는 두 표(Published / Private)로 갈리며
  분류는 명시 결정이 필요하다(Rules: "Adding a new package requires explicit user approval"). 설계 §5는 "SDK
  사용자도 agent-preset를 직접 import"한다고 주장(L116) → published 의도로 보이나 백로그에 미확정.
  _Fix:_ PRESET-001에서 published(beta) 분류를 명시하고 publish-registry Published 표에 행 추가를 Affected에 기재.
  published면 package.json에 `"publishConfig": { "access": "public" }` 필요(publish-registry Rules).

- **AF-04 [dep-edge-undocumented | P1]** — PRESET-006이 `/preset` 명령을 `agent-command`에 두고 agent-preset의
  `listPresets()`를 소비(PRESET-006 L26, L52)하지만, 이는 **신규 엣지 `agent-command → agent-preset`**를 만든다.
  이 엣지는 (a) 설계 §5 엣지 목록(L85-89)에 없고, (b) PRESET-006 Affected Files(L57-61)에 agent-command의
  package.json 의존 추가가 누락됐다. 사이클은 없으나(preset는 command에 의존 안 함) 미등재 엣지다.
  _Fix:_ 설계 §5 엣지 목록에 `agent-command → agent-preset` 추가 + PRESET-006 Affected Files에 agent-command
  package.json 의존 + agent-command SPEC 갱신 명시. (대안: `/preset`가 cli에서 listPresets를 주입받는 형태면
  엣지 회피 가능하나, 그 경우 명령 모듈 패턴과 불일치 — 결정 명문화 필요.)

### P2 (경미)

- **AF-07 [stale-mechanism-claim | P2]** — PRESET-001이 "신규 엣지(`agent-preset → agent-framework`)를
  `scripts/harness/check-dependency-direction.mjs`에 허용 등재"(L30, L99 "필요 시")해야 한다고 기술하나, 이
  스크립트는 엣지를 package.json `dependencies`에서 **동적 도출**한다(L23-58, 하드코딩 allowlist 없음;
  `FORBIDDEN_PRODUCTION_DEPENDENCIES = []`). 적법한 단방향 엣지는 등재 불필요 — 스크립트는 bidirectional /
  core-zero-dep / pass-through만 잡는다. 주장이 오도하나 "필요 시" 단서가 있어 경미. _Fix:_ PRESET-001에서 해당
  등재 문구 제거 또는 "동적 도출이라 별도 등재 불요"로 정정.

- **AF-08 [doc-only honesty-boundary | P2 / info]** — 설계 §2.1·PRESET-005가 reference profile 시스템 프롬프트 복제
  불가를 정직하게 명시하고 generic 식별자 + description 각주 한정을 TC로 강제(PRESET-005 TC-06/07)한 점은
  규칙 준수의 모범 사례다(위반 아님 — HOLDS 보강 기록). naming-style/feedback_no_product_names 완전 충족.

## 6. Counts by Severity

| Severity      | Count | Finding IDs         |
| ------------- | ----- | ------------------- |
| **P0**        | 0     | —                   |
| **P1**        | 3     | AF-01, AF-02, AF-04 |
| **P2 / info** | 2     | AF-07, AF-08        |
| **Total**     | **5** |                     |

(검증 주장 14행 중 HOLDS 9, DRIFT 5; 모든 non-HOLDS는 finding으로 추적됨: #6→AF-04, #8→AF-01, 엣지등재→AF-07, publish→AF-02, listPresets엣지→AF-04.)

## 7. Headline Conclusions

**OVERALL VERDICT: PASS** (P0 = 0). 설계의 핵심 아키텍처 결정 — 신규 `agent-preset` 레이어 배치, 단방향
엣지(`preset→framework`, `cli→preset`), no pass-through re-export, cli 껍데기화 + composition-root 예외,
core zero-dep 보존, generic 식별자(벤더명 금지), SDK React-free, layered assembly, spec-before-code, effort
배선의 framework/provider 소유 — 은 모두 canonical 규칙에 **부합(HOLDS)**한다.

구현 전 보완할 P1 3건(모두 PRESET-001/006의 **등재·결정 누락**이며 설계 방향 자체는 정당):

1. **AF-01 (PRESET-001):** 신규 패키지 시작 버전 `3.0.0-beta.74` + `.changeset` fixed 그룹 등재 명시.
2. **AF-02 (PRESET-001):** preset의 published/private 분류 확정 + publish-registry 표 등재 명시.
3. **AF-04 (PRESET-006):** `agent-command → agent-preset` 신규 엣지를 설계 §5 + PRESET-006 Affected에 명문화.

P2 2건은 선택 정정(AF-07 dep-direction 등재 문구, AF-08은 모범사례 기록). 기계적 베이스라인은 양쪽 PASS이며
설계가 도입할 단방향 엣지는 구현 시 `check-dependency-direction.mjs`가 자동 검증한다.
