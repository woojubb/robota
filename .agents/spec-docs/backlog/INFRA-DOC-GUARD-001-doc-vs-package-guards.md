---
status: review-ready
type: BEHAVIOR
tags: [infra]
---

# INFRA-DOC-GUARD-001: 문서-패키지 정합 가드 (ghost-package + spec-export-coverage)

## Problem

2026-06-14 아키텍처 conformance 감사에서 **0 P0·0 코드 위반**이지만 **37건의 문서-코드 드리프트**가
나왔다(AF-01~AF-37). 기계적 스캔(`harness:conformance`, `harness:scan`)은 의존성 그래프·인터페이스
경계만 검증하고, 다음 부류의 드리프트는 못 잡는다:

1. **ghost package 참조** — 문서가 존재하지 않는 `@robota-sdk/<name>` 또는 `packages/<name>`를 언급
   (예: AF-08 `agent-team` — ARCHITECTURE.md/repository-overview.md가 없는 패키지 참조).
2. **SPEC ↔ export 커버리지** — 패키지가 `src/index.ts`로 export하는데 `docs/SPEC.md`가 전혀 언급하지 않음
   (예: AF-02 agent-framework 프리셋 seam, AF-04 agent-preset 외부 로딩 — export됐지만 SPEC 미문서화).

이 드리프트는 매 릴리스 후 수동 감사로만 잡혔다. 감사 산출물: `.design/architecture-audit/2026-06-14/`.

설계 근거: `.design/architecture-audit/2026-06-14/improvement-proposal.md` (Guard recommendation).

## Architecture Review

### Affected Scope

- `scripts/harness/check-ghost-package-refs.mjs` (NEW) — 문서가 참조하는 `@robota-sdk/<name>`/`packages/<name>`
  토큰이 실제 패키지인지 검사. 아닌 토큰 발견 시 fail. 기존 `workspace-package-name` 가드의 문서 버전.
- `scripts/harness/check-spec-export-coverage.mjs` (NEW) — 각 패키지의 `src/index.ts` export 심볼명 ↔
  `docs/SPEC.md` 텍스트 토큰을 diff. 임계 초과 미언급 export를 **non-blocking 경고**로 보고.
- `package.json` scripts + `harness:scan` 등록(경고는 비차단, ghost-package는 차단 후보).

### Alternatives Considered

1. **수동 감사만 유지(현 상태).**
   - Con: 매 릴리스 후 사람이 감사해야 하고, 누락 시 드리프트 누적(이번 agent-cli 서브트리처럼). Rejected.
2. **기계적 가드 2종 추가(ghost-package 차단 + spec-export-coverage 경고).**
   - Pro: ghost 참조는 결정적으로 차단(AF-08류 재발 방지); export 미문서화는 경고로 가시화(AF-02/04류).
   - Con: spec-export 토큰 매칭은 false positive 가능 → 경고(비차단)로 시작, 임계/허용목록으로 튜닝.

### Decision

**Alternative 2.** ghost-package 가드는 `harness:scan`에 차단으로, spec-export-coverage는 **비차단 경고**로
추가한다(improvement-proposal 권고). 추가로 process: `post-implementation-checklist`에 "공개 `src/index.ts`
변경 PR은 `docs/SPEC.md` + 관련 architecture-map 문서 동기화"를 done-gate 리마인더로 넣는다
(`three_doc_layers_sync` 강제).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — scripts/harness(+package.json), post-implementation-checklist
- [x] Sibling scan 완료 — 기존 `check-architecture-conformance.mjs`/`workspace-package-name` 가드 패턴 확인
- [x] 대안 최소 2개 검토 완료 — 2개(수동 유지 / 기계적 가드)
- [x] 결정 근거 문서화 완료 — ghost=차단·export=경고 분리 + done-gate 프로세스 근거 기록

## Solution (승인 시 확정)

ghost-package 체크 → `harness:scan`에 차단 등록. spec-export-coverage → 비차단 경고로 시작, 허용목록 튜닝.
done-gate 리마인더 추가. 각 가드는 self-test fixture(없는 패키지 참조/미문서화 export)로 검증.

## Affected Files (승인 시 확정)

- `scripts/harness/check-ghost-package-refs.mjs` (NEW)
- `scripts/harness/check-spec-export-coverage.mjs` (NEW)
- `package.json` (scripts + harness:scan aggregation)
- `.agents/skills/post-implementation-checklist/SKILL.md` (done-gate 리마인더)

## Completion Criteria (승인 시 확정)

- [ ] TC-01: 존재하지 않는 패키지명을 참조하는 fixture 문서에 대해 ghost-package 체크가 exit 1
- [ ] TC-02: 모든 문서가 실제 패키지만 참조하는 현 레포에서 ghost-package 체크 exit 0 (`harness:scan` 통과)
- [ ] TC-03: export됐지만 SPEC 미언급 심볼이 있는 패키지에 대해 spec-export-coverage가 경고 출력(비차단)
- [ ] TC-04: `pnpm harness:scan` exit 0 (신규 가드 등록 후에도 전체 통과)

## Test Plan

승인 시 확정. 기계적 가드 2종 + fixture 기반 self-test + harness:scan 통합. 본 문서는 감사
improvement-proposal의 guard 권고를 backlog로 캡처한 것.

## Tasks

- [ ] 미생성 — backlog 상태. 착수 시 draft 승격 후 상세화.

## Evidence Log
