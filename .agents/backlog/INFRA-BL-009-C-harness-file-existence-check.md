---
title: 'INFRA-BL-009-C: check-build-output-contracts.mjs 실제 파일 존재 및 DTS 확장자 검증 강화'
status: todo
created: 2026-05-15
priority: high
urgency: soon
area: scripts/harness/check-build-output-contracts.mjs
depends_on: []
---

## 배경

`scripts/harness/check-build-output-contracts.mjs`는 현재 `package.json`의 `main`, `types`, `exports`, `bin` 경로 패턴만 검증한다. 실제 `dist/` 파일 존재를 확인하지 않으므로:

1. 빌드 도구가 다른 경로에 파일을 생성해도 harness가 통과할 수 있다 (silent failure)
2. DTS 파일이 `.d.mts` 확장자로 생성되어도 `types` 필드가 `.d.ts`를 가리키면 검증 통과

이는 INFRA-BL-009 마이그레이션 PoC 단계에서 잘못된 신호를 줄 수 있다. INFRA-BL-009가 blocked 상태이므로 지금 강화하면 PoC 준비가 완료된다.

## 변경 범위

파일: `scripts/harness/check-build-output-contracts.mjs`

### 추가할 검증 항목

#### 1. dist 파일 존재 확인

`package.json`의 `main`, `types` 필드가 가리키는 파일이 실제로 존재하는지 확인한다.

```js
function checkDistFileExists(pkgDir, pkg) {
  const errors = [];

  // main 파일 존재 확인
  if (pkg.main) {
    const mainPath = path.join(pkgDir, pkg.main);
    if (!fs.existsSync(mainPath)) {
      errors.push(`MISSING main: ${pkg.main}`);
    }
  }

  // types 파일 존재 확인
  if (pkg.types) {
    const typesPath = path.join(pkgDir, pkg.types);
    if (!fs.existsSync(typesPath)) {
      errors.push(`MISSING types: ${pkg.types}`);
    }
  }

  return errors;
}
```

주의: 이 검증은 `dist/` 디렉토리가 없는 패키지(빌드 미실행)에서는 skip하거나 별도 경고로 분리해야 한다. 빌드 미실행 상태를 contract violation으로 취급하면 CI 초기 단계에서 false positive가 발생한다.

구현 옵션:

- `--check-files` 플래그로 opt-in
- dist 디렉토리 존재할 때만 파일 체크 (exists-if-built 모드)

#### 2. DTS 확장자 검증

```js
function checkDtsExtension(pkgDir, pkg) {
  const errors = [];

  if (pkg.types && (pkg.types.endsWith('.d.mts') || pkg.types.endsWith('.d.cts'))) {
    errors.push(`WRONG_DTS_EXT: types="${pkg.types}" — must end with .d.ts (not .d.mts or .d.cts)`);
  }

  // exports 필드 내 types 체크
  if (pkg.exports) {
    const checkExportEntry = (entry, path_) => {
      if (typeof entry === 'string') return;
      if (entry.types && typeof entry.types === 'string') {
        if (entry.types.endsWith('.d.mts') || entry.types.endsWith('.d.cts')) {
          errors.push(`WRONG_DTS_EXT in exports["${path_}"].types: ${entry.types}`);
        }
      }
      // 재귀 체크
      for (const [k, v] of Object.entries(entry)) {
        if (typeof v === 'object' && v !== null) checkExportEntry(v, `${path_}.${k}`);
      }
    };
    for (const [key, val] of Object.entries(pkg.exports)) {
      checkExportEntry(val, key);
    }
  }

  return errors;
}
```

#### 3. browser 빌드 파일 존재 확인 (browser exports 선언 패키지만)

`exports['.'].browser`가 선언된 패키지는 해당 파일 존재를 확인한다.

## 구현 원칙

- 기존 검증 로직을 파괴하지 않는다 (backward compatible)
- 파일 존재 검증은 `dist/` 디렉토리가 존재하는 패키지에만 적용
- 오류 메시지는 기존 형식과 동일하게 유지
- 새 검증 항목은 별도 카운터로 집계

## Test Plan

- [ ] `pnpm harness:scan` 실행 후 기존 76개 패키지 검증 결과 변화 없음
- [ ] dist 파일이 없는 패키지에서 false positive 미발생 확인
- [ ] DTS 확장자 오류 케이스 단위 테스트 추가 (`scripts/harness/__tests__/`)
- [ ] 강화된 검증으로 모든 패키지 통과 확인

## User Execution Test Scenarios

### 시나리오 1: 정상 빌드 패키지 통과 확인

- agent-executability: agent-executable
- 전제조건: `pnpm build` 완료 상태
- 명령:
  ```bash
  cd /Users/jungyoun/Documents/dev/robota
  node scripts/harness/check-build-output-contracts.mjs
  ```
- 예상 결과: 기존과 동일한 통과 결과, 추가된 파일 존재 검증 항목이 출력에 표시됨
- 증거: [구현 후 기록]

### 시나리오 2: DTS 확장자 오류 탐지

- agent-executability: agent-executable
- 전제조건: 테스트용 패키지 또는 fixture에 `"types": "dist/node/index.d.mts"` 기재
- 명령:
  ```bash
  node scripts/harness/check-build-output-contracts.mjs
  ```
- 예상 결과: `WRONG_DTS_EXT: types="dist/node/index.d.mts"` 오류 출력
- 증거: [구현 후 기록]
