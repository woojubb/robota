---
title: 'Phase 2: Build tool migration — tsup 대체 도구 도입'
status: blocked
created: 2026-03-30
priority: medium
urgency: later
packages:
  - all (58 packages)
depends_on:
  - INFRA-BL-008
blocked-by: |
  다음 중 하나가 충족될 때까지 blocked:
  1. tsdown 1.0 안정 릴리즈 출시
  2. tsdown의 Robota package export 계약 호환성(dist/node/index.js, .d.ts 확장자) 공식 확인
  3. 대체 안정 도구(unbuild, Rollup+tsc)의 전 패키지 PoC 완료
---

## Problem

tsup은 유지보수 모드에 진입했으며, 모노레포 DTS 빌드에 구조적 한계가 있다. Phase 1에서 빌드 구조로 우회했지만, 장기적으로는 모노레포 네이티브 지원이 있는 도구가 필요하다.

## Current Status

### 2026-05-05 조사

- `tsdown` 최신 npm 버전은 `0.21.10`이고 2026-05-01에 갱신되었다. 개발은 활발하지만 아직 1.0 안정 릴리즈가 아니다.
- `tsdown` 공식 문서는 tsup 주요 옵션과 마이그레이션 호환성을 제공한다고 설명하지만, Node platform 기본 출력은 현재 Robota 패키지 export 계약과 다르다.
- `packages/auth` 기준 PoC에서 `tsdown src/index.ts --format esm,cjs --dts`는 ESM을 `index.mjs`, DTS를 `index.d.mts`로 출력했다. 현재 패키지들은 `exports["."].node.import = ./dist/node/index.js`, `types = ./dist/node/index.d.ts`를 SSOT로 사용한다.
- `unbuild` 최신 npm 버전은 `3.6.1`이고 안정 릴리즈이지만, 현재 tsup 기반 dual ESM/CJS + DTS 출력 계약을 전 패키지에 일괄 대체하려면 별도 config와 publish surface 검증이 필요하다.
- `tsup` 최신 npm 버전은 `8.5.1`이고 현재 Phase 1의 2-pass 빌드 구조가 CI에서 DTS race를 우회하고 있다.

### 2026-05-05 guardrail

- `scripts/harness/check-build-output-contracts.mjs`를 추가해 build tool 전환 전에 package `main`, `types`, `exports`, `bin`, `build:js`, `build:types` 계약을 기계적으로 확인한다.
- `pnpm harness:scan:build-contracts`를 `pnpm harness:scan`에 포함했다.

### 2026-05-07 recheck

- `tsdown` 최신 npm 버전은 `0.22.0`이고 `latest` dist-tag도 `0.22.0`이다. 아직 1.0 안정 릴리즈가 아니다.
- `unbuild` 최신 npm 버전은 `3.6.1`, `tsup` 최신 npm 버전은 `8.5.1`이다.
- 현재 repo의 build output contract guard는 58개 패키지에서 통과한다.
- 결론: 지금 전환하면 도구 안정성보다 package export/output contract 보존이 더 큰 리스크다. `tsup`을 유지하고, `tsdown` 1.0 또는 출력 확장자/contract 호환성이 확인된 뒤 PoC를 재개한다.

## Prior Art Research

### 조사 완료

| 도구    | 버전   | 조사 날짜  | 조사 결과                                                                                                         |
| ------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| tsdown  | 0.22.0 | 2026-05-07 | ESM 기본 출력이 `.mjs`/`.d.mts` — Robota 계약 불일치, `outExtensions` 옵션으로 `.js`/`.d.ts` 강제 가능한지 미확인 |
| unbuild | 3.6.1  | 2026-05-05 | 안정 릴리즈. stub 모드 지원. 전 패키지 dual ESM/CJS + DTS 계약 전환 검증 필요                                     |
| tsup    | 8.5.1  | 2026-05-07 | 현재 사용 중. 유지보수 모드이나 기능 동작. Phase 1 2-pass 구조가 DTS race를 우회 중                               |

### 미조사 항목

- tsdown `outExtensions` 옵션으로 `.js`/`.d.ts` 출력 계약 유지 가능 여부
- unbuild로 Robota 패키지 1개 실제 PoC (export 계약, bin 엔트리, CJS/ESM 동시 출력)
- tsdown 1.0 릴리즈 타임라인 (공식 milestone 확인)

### References

- tsdown docs: https://tsdown.dev/
- tsdown UserConfig `outExtensions`: https://tsdown.dev/reference/api/interface.userconfig
- tsdown output format: https://tsdown.dev/options/output-format
- npm `tsdown`: latest 버전 확인 필요 (blocked 해제 시 재조사)
- npm `unbuild`: `3.6.1`, modified `2025-08-15T09:08:14.206Z`
- npm `tsup`: `8.5.1`, modified `2025-11-12T21:21:43.186Z`

## Recommendation Gate

blocked 해제 시 마이그레이션 진행 전 다음 항목을 모두 확인한다:

1. **접근법**: leaf package 1개 PoC → 전체 마이그레이션 순서 확인
2. **의도 일치**: build output contract guard(`pnpm harness:scan:build-contracts`) 통과 기준 유지
3. **규칙 부합**: 모든 패키지의 `main`, `types`, `exports`, `bin` 계약이 변경 없이 보존
4. **영향 패키지**: 현재 58개 패키지 전체 (leaf → top-down 순서로 전환)
5. **테스트 계획**: 아래 `## Test Plan` 항목 전체 통과
6. **UETS**: 아래 `## User Execution Test Scenarios` 시나리오 전체 실행 및 증거 기록
7. **사용자 결정 항목**: tsdown vs unbuild vs Rollup+tsc 최종 선택은 PoC 결과 기반 사용자 승인 필요

## Recommendation

지금은 전체 마이그레이션을 진행하지 않는다. 추천 순서는 다음과 같다.

1. 현재 Phase 1 구조는 유지한다. 루트 `pnpm build`가 JS bundle과 DTS 생성을 분리해 CI 병목과 race를 관리하고 있으므로, 안정적인 기준선으로 남긴다.
2. blocked 해제 조건(위 `blocked-by` 목록 중 하나) 충족 전까지 이 task는 blocked 상태로 둔다.
3. 전환 재개 시에는 현재 build contract guard를 기준으로 모든 패키지의 `main`, `types`, `exports`, browser/node entry, CLI bin 제거 후처리, DTS 확장자 계약을 확인한 뒤 1-2개 leaf 패키지에서 PoC를 실행한다.
4. PoC 통과 후에만 패키지 scripts를 일괄 전환한다. lockfile은 반드시 `pnpm install`로 갱신한다.

## Evaluation Candidates

- **tsdown** — tsup 후속, Rolldown 기반, 모노레포 네이티브 지원. 안정화 및 Robota 출력 계약 호환성 대기
- **unbuild** — Nuxt 팀, Rollup 기반, stub 모드 지원
- **Rollup + tsc** — 수동 구성, 가장 유연
- 기타 안정화된 도구가 나오면 재평가

## Prerequisites

- INFRA-BL-008 완료 (Phase 1 빌드 구조 개선)
- 대상 도구의 1.0 안정 릴리즈 또는 충분한 실사용 검증

## Scope

- 도구 선정 및 PoC (1-2개 패키지)
- 전체 마이그레이션
- CI/CD 및 publish 워크플로우 검증

## Test Plan

- [ ] leaf 패키지 1개 PoC: `pnpm --filter <leaf-pkg> build` 성공
- [ ] 전체 빌드 통과: `pnpm build` 성공
- [ ] 빌드 계약 검증: `pnpm harness:scan:build-contracts` 통과 (58개 패키지)
- [ ] 전체 harness 통과: `pnpm harness:scan` 통과
- [ ] typecheck 통과: `pnpm typecheck` 에러 없음
- [ ] 테스트 통과: `pnpm test` 모두 통과
- [ ] publish dry-run: `pnpm publish:beta --dry-run` 성공 (대표 패키지 1개 이상)

## User Execution Test Scenarios

### 시나리오 1: 단일 패키지 빌드 검증 (leaf 패키지 기준)

**전제조건**: blocked 해제 후 대상 도구 설치 및 leaf 패키지 config 전환 완료

**실행 커맨드**:

```bash
pnpm --filter @robota-sdk/agent-core build
ls packages/agent-core/dist/node/
```

**예상 관찰 결과**:

- `index.js`, `index.cjs`, `index.d.ts`, `index.d.cts` 파일이 모두 존재
- `index.mjs` 또는 `index.d.mts` 파일이 없음 (계약 위반)

**Evidence**: `ls packages/agent-core/dist/node/` 출력 캡처 후 아래 기록

```
(구현 후 채움)
```

---

### 시나리오 2: 전체 빌드 + harness scan

**전제조건**: 전체 패키지 스크립트 전환 완료

**실행 커맨드**:

```bash
pnpm build
pnpm harness:scan
```

**예상 관찰 결과**:

- `pnpm build` 성공 (에러 없음)
- `pnpm harness:scan` — `Build output contract check passed for 58 package(s).` 포함 전체 통과

**Evidence**:

```
(구현 후 채움)
```

---

### 시나리오 3: npm pack dry-run 계약 검증

**전제조건**: 시나리오 2 통과 후

**실행 커맨드**:

```bash
pnpm --filter @robota-sdk/agent-core pack --dry-run
```

**예상 관찰 결과**:

- `dist/node/index.js`, `dist/node/index.cjs`, `dist/node/index.d.ts` 포함
- `dist/node/index.mjs`, `dist/node/index.d.mts` 미포함

**Evidence**:

```
(구현 후 채움)
```
