---
title: 'Phase 2: Build tool migration — tsup 대체 도구 도입'
status: blocked
created: 2026-03-30
priority: medium
urgency: later
packages:
  - all (48 packages)
depends_on:
  - INFRA-BL-008
blocked-by: tsdown 1.0 미출시 및 현재 package exports 출력 계약 불일치
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

## Recommendation

지금은 전체 마이그레이션을 진행하지 않는다. 추천 순서는 다음과 같다.

1. 현재 Phase 1 구조는 유지한다. 루트 `pnpm build`가 JS bundle과 DTS 생성을 분리해 CI 병목과 race를 관리하고 있으므로, 안정적인 기준선으로 남긴다.
2. `tsdown` 1.0 또는 출력 계약 호환성이 확보되기 전까지 이 task는 blocked 상태로 둔다.
3. 전환 재개 시에는 먼저 shared build contract를 만든다. 모든 패키지의 `main`, `types`, `exports`, browser/node entry, CLI bin 제거 후처리, DTS 확장자 계약을 하나의 검증 스크립트로 확인한 뒤 1-2개 leaf 패키지에서 PoC를 실행한다.
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

## Next Step

`tsdown` 1.0 안정 릴리즈 또는 출력 계약 호환성 확보 후, build contract 검증 스크립트 → leaf package PoC → 전체 전환 순서로 진행한다.

## References

- tsdown docs: https://tsdown.dev/
- tsdown UserConfig `outExtensions`: https://tsdown.dev/reference/api/interface.userconfig
- tsdown output format: https://tsdown.dev/options/output-format
- npm `tsdown`: `0.21.10`, modified `2026-05-01T11:48:48.336Z`
- npm `unbuild`: `3.6.1`, modified `2025-08-15T09:08:14.206Z`
- npm `tsup`: `8.5.1`, modified `2025-11-12T21:21:43.186Z`

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
