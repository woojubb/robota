# INFRA-BL-009 종합 리뷰 및 개선 백로그 계획

**작성일**: 2026-05-15  
**근거 문서**:

- [아키텍처 리뷰](review-INFRA-BL-009-architect.md)
- [시니어 개발자 리뷰](review-INFRA-BL-009-senior-dev.md)

---

## 1. 종합 결론

두 관점의 리뷰가 공통으로 지적한 핵심 문제는 다음과 같다.

### 1.1 규칙 위반 사항 (즉시 교정 필요)

| 위반 규칙                                             | 내용                                                                                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `backlog-execution.md` §User Execution Test Scenarios | `## 검증` 섹션이 빌드/typecheck/lint만 기재 — 이는 Test Plan 항목이며 User Execution Test Scenarios가 아님. **규칙 직접 위반** |
| `research.md` §Research-First                         | `## Prior Art Research` 섹션 없음. 버전 스냅샷 수준 조사만 존재                                                                |
| `spec-workflow.md` §Spec-First                        | 인프라 계약 변경(57개 패키지 export 계약)임에도 설계 문서/SPEC 업데이트 계획 없음                                              |

### 1.2 설계 미비 사항 (blocked 해제 전 필수 완성)

| 항목                        | 현재 상태                    | 필요 상태                                            |
| --------------------------- | ---------------------------- | ---------------------------------------------------- |
| Recommendation Gate         | 부분 작성                    | 전체 7개 항목 완성                                   |
| 패키지 유형 분류            | "all 48 packages"(실제 57개) | node-only / browser-dual / bin / react 분류          |
| 도구 선정 Decision Matrix   | 없음                         | tsdown vs unbuild vs tsup 유지 비교                  |
| PoC 성공 기준               | 없음                         | 구체적 체크리스트                                    |
| 롤백 계획                   | 없음                         | 단계별 롤백 절차                                     |
| 아키텍처 문서 업데이트 목록 | 없음                         | 마이그레이션 후 갱신 문서 목록                       |
| Harness 강화 계획           | 없음                         | check-build-output-contracts.mjs 파일 존재 검증 추가 |

### 1.3 기술 리스크 (PoC에서 반드시 검증)

| 리스크                 | 심각도   | 내용                                      |
| ---------------------- | -------- | ----------------------------------------- |
| DTS 출력 확장자 불일치 | Critical | tsdown 기본값 `.d.mts`, 현재 계약 `.d.ts` |
| browser/node dual 빌드 | Critical | 신규 도구 지원 여부 미확인                |
| bin entry 보존         | High     | agent-cli의 shebang + 실행권한 유지       |
| DTS 토폴로지 빌드 전략 | High     | `build-types-ordered.mjs` 호환성 확인     |
| Harness silent pass    | High     | 경로 패턴만 검사, 실제 파일 존재 미확인   |

---

## 2. 개선 백로그 목록

아래 백로그들은 INFRA-BL-009의 blocked 해제 조건과 설계 완성을 위한 작업들이다. 각각 독립 PR로 진행한다.

---

### INFRA-BL-009-A: 백로그 재작성 — 규칙 준수 구조

**우선순위**: high  
**urgency**: soon  
**선행조건**: 없음 (즉시 가능)

**내용**:

- `## 검증` 섹션을 `## Test Plan`으로 교체 및 구체화
- `## User Execution Test Scenarios` 섹션 신규 작성 (시나리오 3개)
- `## Prior Art Research` 섹션 신규 작성
- `## Recommendation Gate` 섹션 신규 작성 (7개 항목)
- 패키지 수 정정: "48 packages" → 실제 수 (harness:scan 기준)
- blocked 해제 조건 명확화 (택 1 조건 목록)

**User Execution Test Scenarios**: N/A — 이 작업 자체는 문서 재작성이며 runnable behavior 변경 없음. 검증은 `pnpm harness:scan`으로 backlog 파일 형식 준수 확인.

---

### INFRA-BL-009-B: Prior Art Research — 빌드 도구 비교 조사

**우선순위**: medium  
**urgency**: soon  
**선행조건**: INFRA-BL-009-A

**내용**:

1. **tsdown `outExtensions` API 검증**: `https://tsdown.dev/reference/api/interface.userconfig`에서 `dts` 키 지원 여부 확인
2. **unbuild browser dual 빌드 지원 확인**: unbuild 공식 문서에서 browser/node 분리 빌드 가이드 조사
3. **동일 규모 모노레포 사례 조사**: tRPC, Radix UI, Effect 등 대형 TS 모노레포의 빌드 도구 선택 근거 조사
4. **tsup 8.5.x 실질적 유지보수 수준 재평가**: GitHub 이슈/릴리즈 노트 기준 실질 유지보수 여부
5. **Decision Matrix 작성**: 도구별 기준별 점수 표

**결과물**: `## Prior Art Research` 섹션 + Decision Matrix → INFRA-BL-009 태스크 파일에 반영

**User Execution Test Scenarios**: N/A — 조사 결과 문서화이며 runnable behavior 변경 없음.

---

### INFRA-BL-009-C: Harness 강화 — Build Output Contract 파일 존재 검증

**우선순위**: high  
**urgency**: soon  
**선행조건**: 없음 (INFRA-BL-009 blocked와 무관하게 즉시 가능)

**내용**: `scripts/harness/check-build-output-contracts.mjs` 강화

현재: `package.json`의 `main`, `types`, `exports` 경로 패턴만 검증
추가: 실제 dist 파일 존재 확인

```js
// 추가할 검증 항목
function checkFileExists(pkgDir, relativePath) {
  const fullPath = path.join(pkgDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    return `MISSING: ${relativePath}`;
  }
  return null;
}

// DTS 확장자 검증
function checkDtsExtension(typesField) {
  if (typesField.endsWith('.d.mts') || typesField.endsWith('.d.cts')) {
    return `WRONG_EXTENSION: ${typesField} — must be .d.ts`;
  }
  return null;
}
```

**User Execution Test Scenarios**:

- agent-executable
- 명령: `pnpm harness:scan` (또는 `node scripts/harness/check-build-output-contracts.mjs`)
- 예상 결과: 추가된 파일 존재 검증 항목이 출력에 표시됨, dist 파일 없을 때 MISSING 오류 발생
- 증거: [구현 후 기록]

---

### INFRA-BL-009-D: PoC 실행 — auth 패키지 (tsdown)

**우선순위**: low  
**urgency**: later  
**선행조건**: INFRA-BL-009-B (Research 완료), tsdown 1.0 출시 또는 outExtensions PoC 준비

**내용**: `packages/auth`에서 tsdown 마이그레이션 PoC

1. `tsdown.config.ts` 작성 (outExtensions로 계약 보존)
2. `build:js`, `build:types` 스크립트 업데이트
3. 빌드 실행 및 출력 파일 구조 검증
4. `pnpm harness:scan` 통과 확인
5. tsup 대비 빌드 시간 측정

**성공 기준**:

```
[ ] dist/node/index.js 존재
[ ] dist/node/index.cjs 존재
[ ] dist/node/index.d.ts 존재 (.d.mts 아님)
[ ] pnpm harness:scan 통과
[ ] require('./dist/node/index.cjs') 성공
[ ] TypeScript에서 import 타입 resolution 성공
```

**User Execution Test Scenarios**:

- agent-executable
- 명령:
  ```bash
  pnpm --filter @robota-sdk/auth build
  ls packages/auth/dist/node/
  pnpm harness:scan
  ```
- 예상 결과: index.js, index.cjs, index.d.ts 존재, harness scan 통과
- 증거: [구현 후 기록]

---

### INFRA-BL-009-E: PoC 실행 — auth 패키지 (unbuild, 비교군)

**우선순위**: low  
**urgency**: later  
**선행조건**: INFRA-BL-009-B (Research 완료)

**내용**: INFRA-BL-009-D와 동일 패키지에서 unbuild로 비교 PoC

**목적**: Decision Matrix의 실증적 비교 데이터 확보

**성공 기준**: INFRA-BL-009-D와 동일

---

### INFRA-BL-009-F: 전체 마이그레이션 설계 — 단계별 계획 문서

**우선순위**: low  
**urgency**: later  
**선행조건**: INFRA-BL-009-D 또는 INFRA-BL-009-E 중 하나 PoC 성공

**내용**: `.design/build-tool-migration-design.md` 작성

포함 내용:

- 선정 도구 및 근거
- 패키지 유형 분류 (node-only / browser-dual / bin / react)
- 단계별 마이그레이션 계획 (5단계)
- 각 단계의 검증 게이트 및 선행 조건
- 롤백 절차 (tsup.config.ts.bak 보존 전략)
- 예상 빌드 시간 변화
- 마이그레이션 후 갱신할 아키텍처 문서 목록

**User Execution Test Scenarios**: N/A — 설계 문서 작성이며 runnable behavior 변경 없음.

---

## 3. 실행 순서

```
즉시 실행 가능:
  INFRA-BL-009-A: 백로그 재작성 (blocked와 무관)
  INFRA-BL-009-C: Harness 강화 (blocked와 무관)

tsdown/unbuild 조사 단계:
  INFRA-BL-009-B: Prior Art Research

blocked 해제 조건 충족 후:
  INFRA-BL-009-D: tsdown PoC
  INFRA-BL-009-E: unbuild PoC (병렬 가능)

PoC 성공 후:
  INFRA-BL-009-F: 전체 마이그레이션 설계

설계 승인 후:
  (신규 백로그) 패키지 유형별 단계적 전환 PR 5개
```

---

## 4. 핵심 인사이트

1. **즉시 실행 가능한 작업이 2개 있다**: INFRA-BL-009-A(백로그 재작성)와 INFRA-BL-009-C(Harness 강화). 이 둘은 tsdown 1.0 출시와 무관하게 지금 진행할 수 있다.

2. **Harness 강화(INFRA-BL-009-C)가 특히 가치 있다**: 현재 harness는 경로 패턴만 검증하므로, 마이그레이션 중 silent failure 위험이 있다. 이를 먼저 강화하면 이후 PoC 단계에서 검증 신뢰도가 높아진다.

3. **tsup 유지보수 모드는 실질적 위험이 아직 없다**: Phase 1의 2-pass 구조가 DTS race를 해결하고 있으므로, 신규 도구의 안정성 확보 없이 서두를 필요가 없다. blocked 전략은 타당하다.

4. **PoC는 비교군을 동시에 실행해야 한다**: tsdown과 unbuild를 동일 패키지에서 비교해야 합리적 선정이 가능하다. 한 도구만 PoC하면 비교 근거가 없다.

---

## Test Plan

이 문서는 종합 리뷰/분석 문서이며 구현 변경 없음. 문서 완성도 검증:

- 아키텍처 리뷰 및 시니어 개발자 리뷰 양쪽의 핵심 결론이 종합 평가 테이블에 반영되었는지 확인
- 파생 백로그 항목(INFRA-BL-009-A~F)의 선행조건 및 우선순위가 종합 결론과 일치하는지 확인
- `pnpm harness:scan` 실행 시 이 파일이 scan 대상에 포함되어 오류 없이 통과하는지 확인
