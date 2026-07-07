---
status: done
type: BEHAVIOR
tags: [infra]
---

# INFRA-DOC-GUARD-001: 문서-패키지 정합 가드 (ghost-package refs + bidirectional public-surface)

## Problem

2026-06-14 아키텍처 conformance 감사에서 **0 P0·0 코드 위반**이지만 **37건의 문서-코드 드리프트**가
나왔다(AF-01~AF-37). 기계적 스캔(`harness:conformance`, `harness:scan`)은 의존성 그래프·인터페이스
경계만 검증하고, 다음 부류의 드리프트는 못 잡는다:

1. **ghost package 참조** — 문서가 존재하지 않는 `@robota-sdk/<name>` 또는 `packages/<name>`를 언급
   (예: AF-08 `agent-team` — ARCHITECTURE.md/repository-overview.md가 없는 패키지 참조).
2. **미문서화 public export** — 패키지가 `src/index.ts`로 런타임 export하는데 `docs/SPEC.md`의 Public API 표가
   그 심볼을 열거하지 않음(예: AF-02 agent-framework 프리셋 seam, AF-04 agent-preset 외부 로딩 — export됐지만
   SPEC 미문서화). 기존 `check-spec-public-surface`는 **정방향**(SPEC 표 → `src/` 존재, phantom 검출)만 잡고
   이 **역방향**(export → 표 누락)은 놓친다.

이 드리프트는 매 릴리스 후 수동 감사로만 잡혔다. 감사 산출물: `.design/architecture-audit/2026-06-14/`.
설계 근거: `.design/architecture-audit/2026-06-14/improvement-proposal.md` (Guard recommendation).

## Architecture Review

### Affected Scope

- `scripts/harness/check-ghost-package-refs.mjs` (NEW) — 레포 문서(`*.md`)가 참조하는 `@robota-sdk/<name>`
  npm-name 토큰 + SPEC.md 밖 문서의 `packages/<name>` 디렉터리 토큰이 실제 워크스페이스 패키지인지 검사. 아닌
  토큰 발견 시 **차단**(exit 1). 패키지명 집합과 `@robota-sdk/*` 토큰 패턴은 기존 `workspace-packages.mjs` /
  `check-workspace-refs.mjs`의 **동일 SSOT를 재사용**(정규식 포크 금지). 문서 전용 면제(코드펜스/인라인코드
  예시, `(planned)`/`(removed)` 어휘 라인, 문서화된 allowlist)만 추가한다.
- `scripts/harness/check-spec-public-surface.mjs` (**EXTEND, not new**) — 현재 정방향(Public API 표 심볼 →
  `src/` 존재) 검사에 **역방향 edge를 추가**: 각 패키지 `src/index.ts`의 **런타임** export(TS-AST 추출,
  `export type`/interface 제외)는 그 패키지 SPEC의 Public API 표에 행으로 존재해야 한다. 한 가드가 "Public API
  표 ⟷ 실제 public surface" 양방향을 SSOT로 소유한다. 결정적 판정이므로 **차단**하되, 의도적 내부-노출 export는
  이유를 적은 frozen allowlist(baseline)로 면제(기존 `check-orphan-exports`의 baseline 선례).
- `.agents/skills/spec-writing-standard/` (또는 document-standards SPEC 계약) — 완전성 조항 1건 게시:
  "SPEC의 Public API 표는 패키지 엔트리(`src/index.ts`)의 모든 런타임 export를 열거해야 한다." 가드는 이 계약에서
  파생된다(Contract-Before-Automation).
- `.agents/skills/post-implementation-checklist/SKILL.md` — 공개 surface 변경 PR의 SPEC 동기화 리마인더(백스톱).

### Delta vs existing scans (de-confliction)

기존 스캔 조사(리뷰에서 실제 코드로 검증) 결과, 두 가드는 커버되지 않는 실제 gap만 겨냥하고 기존 스캔과 **판정도
입력도** 겹치지 않도록 설계한다:

| 기존 스캔                                        | 검사 방향/범위                                                  | 본 가드와의 경계                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `check-workspace-refs`                           | `package.json` 스크립트·`.mjs`의 `@robota-sdk/*` 토큰(비 `.md`) | ghost-package는 **`.md` 문서 코퍼스**를 담당(입력이 다름). 토큰 패턴·패키지 집합 SSOT는 **공유**한다. |
| `check-spec-paths` (spec-ghost-path)             | SPEC.md 내부의 확장자 있는 `src/**`·`packages/<name>/**` 경로   | ghost-package는 **npm-name형** + **SPEC.md 밖 문서**의 bare `packages/<name>` 디렉터리 토큰           |
| `check-document-standards-index` (ghost-pointer) | document-standards **인덱스 포인터**                            | 인덱스 외 일반 문서                                                                                   |
| `check-spec-public-surface` (정방향)             | Public API 표 심볼 → `src/` 존재 (SPEC→code, phantom)           | **같은 가드를 확장**해 역방향(export→표) edge 추가 — 별도 스캐너를 세우지 않음(SSOT 유지)             |
| `check-orphan-exports`                           | export 심볼이 **다른 파일**에서 참조되는지                      | SPEC 표 커버리지와 무관                                                                               |

### Alternatives Considered

1. **수동 감사만 유지(현 상태).** Con: 매 릴리스 후 사람이 감사, 누락 시 드리프트 누적. Rejected.
2. **별도 fuzzy `check-spec-export-coverage.mjs`를 비차단 경고로 추가.** Con: full-text 토큰 매칭은 noise가
   많아 영구 비차단 경고로 전락 → 에이전트가 무시, 장기 강제력 0. 완전성 계약 없이 임의 target에 가드를 세우는
   것은 Contract-Before-Automation 위반. `check-spec-public-surface`의 SPEC-parse/src-read를 **중복 구현**해
   SSOT를 깬다. Rejected(리뷰 지적).
3. **ghost-package 차단 가드(신규) + `check-spec-public-surface` 양방향 확장(차단, frozen allowlist) +
   완전성 계약 게시.** Pro: ghost 참조는 결정적 차단(AF-08류 재발 방지); export↔표는 결정적 양방향이라 **차단**
   가능(AF-02/04류 재발 방지) + 단일 가드 SSOT; 계약에서 파생하므로 RULE-007 준수. Con: 차단 전환 전 현재 미문서화
   export를 0으로 몰거나 이유 있는 baseline allowlist로 동결하는 burndown 필요 — 이는 감사가 찾은 드리프트를
   해소하는 작업 자체이며 회피 사유가 아님. **Chosen.**

### Decision

**Alternative 3.** ghost-package는 신규 차단 가드(워크스페이스 SSOT 재사용). 미문서화 export는 `check-spec-public-surface`
를 양방향으로 확장해 **차단**(frozen allowlist baseline)하고, 그 근거가 되는 완전성 조항을 SPEC 계약에 먼저 게시한다.
`post-implementation-checklist` 리마인더는 기계 가드의 **백스톱**으로만 둔다(강제력은 가드가 진다).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — scripts/harness, spec-writing-standard/document-standards 계약, post-implementation-checklist
- [x] Sibling scan 완료 — `check-workspace-refs`/`workspace-packages`(SSOT), `check-spec-public-surface`(정방향), `check-orphan-exports`(baseline 선례) 실제 코드 확인
- [x] 대안 최소 2개 검토 완료 — 3개(수동 / 별도 fuzzy 경고 / 확장+차단)
- [x] 결정 근거 문서화 완료 — 별도 스캐너 대신 단일 가드 확장 + 계약 선게시 + 차단(리뷰 반영)

## Solution

1. **ghost-package (차단):** `check-ghost-package-refs.mjs` — `*.md` 문서(`.git`/`node_modules` 제외)에서
   `@robota-sdk/<name>` 토큰 및 SPEC.md 밖 문서의 bare `packages/<name>` 토큰을 추출 → `workspace-packages.mjs`의
   패키지 집합과 `check-workspace-refs`의 `@robota-sdk/*` 패턴을 재사용해 대조. 미존재 → exit 1. 코드펜스/인라인,
   `(planned)`/`(removed)` 라인, 문서화된 allowlist는 면제.
2. **완전성 계약 게시 + 양방향 확장 (차단):** 먼저 SPEC 계약(spec-writing-standard / document-standards)에
   "Public API 표는 `src/index.ts`의 모든 런타임 export를 열거한다"를 명문화. 그 뒤 `check-spec-public-surface.mjs`
   에 역방향 edge를 추가 — `src/index.ts` 런타임 export(AST, `export type`/interface 제외)가 표에 없으면 finding.
   현재 미문서화 export를 이유 있는 frozen allowlist로 동결(baseline) 후 **차단** 전환; 신규 미문서화 export만 차단.
3. **done-gate 백스톱:** `post-implementation-checklist`에 "공개 `src/index.ts` 변경 PR은 `docs/SPEC.md` Public API
   표 동기화 확인" 리마인더 추가.

각 가드는 `scripts/harness/__tests__/`에 fixture self-test를 둔다. ghost-package는 `run-all-scans.mjs`에 신규 등록,
public-surface 확장은 기존 등록을 유지한다.

## Affected Files

- `scripts/harness/check-ghost-package-refs.mjs` (NEW) + `__tests__/check-ghost-package-refs.test.mjs` (NEW)
- `scripts/harness/check-spec-public-surface.mjs` (EXTEND: 역방향 edge + frozen allowlist) + 해당 `__tests__` 확장
- `scripts/harness/run-all-scans.mjs` (ghost-package 신규 등록)
- `.agents/skills/spec-writing-standard/SKILL.md` 또는 document-standards SPEC 계약 (완전성 조항 게시)
- `.agents/skills/post-implementation-checklist/SKILL.md` (done-gate 백스톱 리마인더)

## Completion Criteria

- [ ] TC-01: `@robota-sdk/<ghost>`를 참조하는 fixture 문서에 대해 ghost-package 체크 exit 1
- [ ] TC-02: SPEC.md 밖 문서의 bare `packages/<ghost>` 참조 fixture → finding; 클린 레포 라이브 스캔 exit 0
- [ ] TC-03: ghost-package가 패키지 집합·`@robota-sdk/*` 패턴을 `workspace-packages`/`check-workspace-refs` SSOT에서 취함(포크된 목록/정규식 없음 — 테스트로 고정)
- [ ] TC-04: `src/index.ts` 런타임 export가 SPEC Public API 표에 누락된 fixture → public-surface 역방향 finding(차단); `export type`/interface는 무시; allowlist 항목은 면제
- [ ] TC-05: 완전성 조항이 spec-writing-standard/document-standards 계약에 게시되어 있고 가드가 그로부터 파생됨을 명시
- [ ] TC-06: 현 레포 baseline 동결 후 `pnpm harness:scan` exit 0(양방향 확장·ghost-package 등록 포함 전체 green)

## Test Plan

- **ghost-package**: `__tests__/check-ghost-package-refs.test.mjs` — (a) `@robota-sdk/<ghost>` → finding, (b) SPEC.md 밖 `packages/<ghost>` → finding, (c) 코드펜스·`(planned)`·allowlist → 면제, (d) SSOT 재사용 검증(포크 없음), (e) 클린 라이브 스캔 exit 0.
- **public-surface 양방향**: 기존 test 확장 — (a) 정방향(phantom) 회귀 유지, (b) `src/index.ts` export가 표에 없으면 역방향 finding(차단), (c) `export type`/interface 무시, (d) allowlist 면제, (e) baseline 동결 후 라이브 exit 0.
- **통합**: baseline 동결 후 `pnpm harness:scan` 전체 green. 본 문서는 감사 improvement-proposal의 guard 권고를, 리뷰 반영해 단일-가드-확장 + 완전성 계약 형태로 확정한 것.

## Tasks

- [ ] 미생성 — GATE-WRITE 승격 시 상세화.

## Evidence Log

- 2026-07-08 GATE-APPROVAL round 1 — proposal-reviewer REVISE. Guard 1(ghost-package) 승인 가능하나 워크스페이스
  SSOT 재사용 요구; Guard 2는 별도 fuzzy 비차단 스캐너가 잘못(RULE-007 위반 + SSOT 중복) → `check-spec-public-surface`
  양방향 확장 + 완전성 계약 게시 + frozen allowlist 차단으로 재설계. 본 개정에 반영(Alternative 3).
- 2026-07-08 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. 모든 REVISE 포인트 해소(SSOT 재사용 TC-03,
  단일-가드 양방향 확장, 완전성 계약 선게시 TC-05, frozen baseline 차단, done-gate 백스톱 강등). 비차단 구현 노트:
  reverse edge는 barrel re-export(`export * from`/`export { A } from`)를 따라 실제 심볼명까지 해석해야 함
  (`check-orphan-exports.mjs:150-160` 로직 재사용). 승인 → 구현 착수.
- 2026-07-08 GATE-IMPLEMENT/VERIFY/COMPLETE — Guard 1 `check-ghost-package-refs.mjs` (NEW, blocking): scans
  `*.md`, imports `TOKEN_PATTERN`+`listWorkspacePackageNames` from `check-workspace-refs.mjs` (SSOT extracted,
  no fork — TC-03), exempts code fences/inline/absence-vocab/immutable historical corpora + a 3-entry documented
  `GHOST_PACKAGE_ALLOWLIST` (dag-nodes container, bytedance phantom dep, `packages/apps` shorthand). Guard 2:
  extended `check-spec-public-surface.mjs` with the reverse `spec-undocumented-export` edge (TS-AST effective
  runtime exports of entry incl. recursive `export *`/`export {} from` barrels, type-only excluded), BLOCKING,
  with a frozen 679-entry `UNDOCUMENTED_EXPORT_ALLOWLIST` baseline (audit drift backlog; new undocumented exports
  fail). Completeness clause published in `spec-writing-standard`; done-gate backstop in `post-implementation-checklist`;
  `ghost-package-refs` registered in `run-all-scans`. Verified: 15/15 guard+regression tests, `pnpm harness:scan`
  **48/48 exit 0**. TC-01..06 met. Harness-only → no changeset. DONE.
