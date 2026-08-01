---
title: 'DOCFIX-003: 미사용 typedoc devDependencies 제거 (api-reference retire 후속)'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: low
urgency: later
area: package.json
depends_on: []
---

# DOCFIX-003: 미사용 typedoc devDependencies 제거

## Problem

DOCS-006(api-reference retire)에서 생성기(`docs-generator.js`)와 `typedoc.json`을 제거했으나,
루트 `package.json`의 `typedoc ^0.25.13`, `typedoc-plugin-markdown ^3.17.1` devDependencies는 남아
있다. 이를 사용하는 스크립트가 더 이상 없어 dead dependency다.

## Solution

`package.json`에서 두 devDependency 제거 후 `pnpm install`로 lockfile 갱신. frozen-lockfile 정합성
검증(pre-push lockfile 체크). 다른 곳에서 typedoc을 import/실행하지 않음을 사전 확인.

## Completion Criteria

- [x] TC-01: `package.json` devDependencies에서 `typedoc`/`typedoc-plugin-markdown` 제거
- [x] TC-02: 레포 내 typedoc 실행/참조 0건 (스크립트·설정, next-env 주석 제외)
- [x] TC-03: `pnpm install` 후 `pnpm-lock.yaml` 정합(frozen-lockfile 통과)
- [x] TC-04: `pnpm harness:scan` + 빌드 통과

## Test Plan

| TC-ID | Test Type | Approach                                                          |
| ----- | --------- | ----------------------------------------------------------------- |
| TC-01 | Doc/grep  | package.json diff 확인                                            |
| TC-02 | Grep      | `rg "typedoc" --glob '!**/node_modules/**'` 잔여 참조 0           |
| TC-03 | Build     | `pnpm install --frozen-lockfile --lockfile-only` (throwaway) 통과 |
| TC-04 | Harness   | `pnpm harness:scan`                                               |

## User Execution Test Scenarios

Not applicable — 빌드 도구 의존성 정리. 런타임/사용자 동작 무변경.

## Tasks

- [x] typedoc 잔여 참조 확인 → devDeps 제거 → pnpm install → lockfile/harness 검증

## Evidence Log

### 구현 완료 — 2026-06-16

- **TC-01:** `package.json` devDependencies에서 `typedoc ^0.25.13`, `typedoc-plugin-markdown ^3.17.1`
  제거. `knip.json`의 `ignoreDependencies`에서도 두 항목 제거(동반 stale).
- **TC-02:** typedoc 잔여 참조 — `content/v2.0.0/`(동결 아카이브) 외 활성 스크립트/설정 0건 확인.
- **TC-03:** `pnpm install`로 lockfile 갱신(typedoc + 전이 12패키지 제거). `pnpm install
--frozen-lockfile --lockfile-only` **exit 0**(정합).
- **TC-04:** `pnpm harness:scan` **26/26 passed**.
