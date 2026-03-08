# Coding Rules Implementation

## Status: in-progress

## Priority: high

## Scope

coding-rules-audit.md에서 수용된 17개 제안을 프로젝트에 실제 적용하는 작업.

---

## Category A: AGENTS.md 규칙 업데이트 (문서 변경)

브랜치: `chore/coding-rules-update`

### A-1. Commit subject 72자 (P1-03)

**파일:** `AGENTS.md` → Git Operations 섹션
**변경:** `max 80 chars` → `max 72 chars`

### A-2. Result type 의무화 (P1-02)

**파일:** `AGENTS.md` → No Fallback Policy 섹션에 추가
```
- Public domain functions that can fail MUST return Result<T, E>. Throwing is reserved for truly unexpected programmer errors.
```

### A-3. Immutability + Parameter mutation 금지 (P1-07, P2-03)

**파일:** `AGENTS.md` → Development Patterns 섹션에 추가
```
- Prefer readonly properties and parameters. Mutation should be explicit and localized.
- Never mutate function parameters directly. Clone or create new objects instead.
```

### A-4. Null vs Undefined convention (P2-02)

**파일:** `AGENTS.md` → Type System 섹션에 추가
```
- Prefer `undefined` over `null` for absence of value. `null` is allowed only at API boundaries (JSON serialization).
```

### A-5. Magic number/string 금지 (P2-10)

**파일:** `AGENTS.md` → Development Patterns 섹션에 추가
```
- No magic numbers or strings. Use named constants with descriptive names. Exceptions: 0, 1, -1 as array/math primitives.
```

### A-6. Graceful shutdown (P2-09)

**파일:** `AGENTS.md` → Development Patterns 섹션 뒤에 새 섹션 추가
```
### Process Lifecycle
- Applications in `apps/` must handle SIGTERM and SIGINT for graceful shutdown.
- In-progress work must complete or be safely cancelled within a configurable timeout.
- All acquired resources (connections, file handles) must be released on shutdown.
```

### A-7. File/function size 규칙 격상 (P1-04)

**파일:** `AGENTS.md` → Development Patterns 섹션에 추가
```
- Production files should not exceed 300 lines. Functions should not exceed 50 lines. Exceptions require justification in code review.
```

### A-8. I*/T* prefix 정책 업데이트 (P1-01)

**파일:** `AGENTS.md` → Type System 섹션
**변경:** 기존 규칙에 방향성 추가
```
- `I*` prefix is for interfaces only. `T*` prefix is for type aliases only.
- New code should prefer descriptive names without prefixes where clarity is not compromised. Existing prefixed names may be migrated gradually.
```

---

## Category B: ESLint 설정 변경

브랜치: `chore/eslint-rules-expansion`

### B-1. 신규 ESLint 룰 추가

**파일:** `.eslintrc.json`

추가할 룰:
```json
{
  "complexity": ["warn", 15],
  "max-lines": ["warn", { "max": 300, "skipBlankLines": true, "skipComments": true }],
  "max-lines-per-function": ["warn", { "max": 50, "skipBlankLines": true, "skipComments": true }],
  "no-param-reassign": ["error", { "props": false }],
  "no-magic-numbers": ["warn", {
    "ignore": [-1, 0, 1, 2],
    "ignoreArrayIndexes": true,
    "ignoreDefaultValues": true,
    "enforceConst": true
  }]
}
```

**전략:** `warn`으로 시작 → 위반 수정 후 `error`로 격상

### B-2. a11y 플러그인 추가 (P2-06)

**파일:** `apps/web/.eslintrc.json`, `packages/dag-designer/.eslintrc.json` (UI 패키지만)
**패키지:** `eslint-plugin-jsx-a11y` 설치

### B-3. 테스트 파일 예외

**파일:** `.eslintrc.json` → test overrides 섹션
- `max-lines`, `max-lines-per-function`, `complexity`, `no-magic-numbers`: off

---

## Category C: CI 및 도구 도입

브랜치: `chore/ci-tooling-expansion`

### C-1. pnpm audit CI 추가 (P2-07)

**파일:** `.github/workflows/ci.yml`
```yaml
- name: Security audit
  run: pnpm audit --audit-level high
```

### C-2. Coverage threshold (P1-06)

**파일:** vitest 설정 또는 CI workflow
```yaml
- name: Test with coverage
  run: pnpm test -- --coverage --coverage.thresholds.lines=80
```
- 새 코드 80% line coverage gate

### C-3. Dependency direction 자동 검증 (P1-05)

**옵션:** `dependency-cruiser` 도입
**파일:** `.dependency-cruiser.cjs` 설정 + `pnpm harness:scan`에 통합
- `.agents/project-structure.md`의 방향 규칙을 기계적으로 검증

### C-4. Dead code 감지 (P2-04)

**패키지:** `knip` 설치
**파일:** `knip.json` 설정
**스크립트:** `pnpm knip` → unused exports/files 감지

---

## Category D: 스킬 추가/업데이트

브랜치: `chore/skills-expansion`

### D-1. effect-style-error-modeling 스킬 보강 (P1-02)

**파일:** `.agents/skills/effect-style-error-modeling/SKILL.md`
- Result type 사용 의무화 워크플로 추가
- throw vs Result 판단 기준 명시

### D-2. Logging level guide 스킬 신규 (P2-05)

**파일:** `.agents/skills/logging-level-guide/SKILL.md` (신규)
- error/warn/info/debug 사용 기준
- 로깅 anti-patterns

### D-3. API error response 표준 (P2-08)

**파일:** `.agents/skills/api-error-standard/SKILL.md` (신규)
- RFC 7807 Problem Details 형식
- dag-api의 IProblemDetails를 SSOT로 지정

### D-4. package-code-review 스킬 보강 (P1-04)

**파일:** `.agents/skills/package-code-review/SKILL.md`
- file/function size check를 review perspective에 추가

---

## 실행 순서

| 순서 | 카테고리 | 브랜치 | 의존성 |
|------|---------|--------|--------|
| 1 | A (규칙 업데이트) | `chore/coding-rules-update` | 없음 |
| 2 | D (스킬 추가/업데이트) | `chore/skills-expansion` | A 완료 후 |
| 3 | B (ESLint 설정) | `chore/eslint-rules-expansion` | A 완료 후 |
| 4 | C (CI/도구) | `chore/ci-tooling-expansion` | B 완료 후 |

각 브랜치는 develop에서 분기, 완료 후 develop에 머지.

---

## 검증 체크리스트

- [x] AGENTS.md 규칙 추가 (A-1 ~ A-8)
- [x] ESLint 룰 추가 및 기존 코드 위반 scan (B-1 ~ B-3, B-2 a11y는 별도)
- [x] CI workflow 업데이트 (C-1 audit, C-4 knip)
- [ ] CI coverage threshold (C-2)
- [ ] Dependency direction 자동 검증 (C-3, dependency-cruiser)
- [x] 스킬 파일 작성/갱신 (D-1 ~ D-4)
- [x] pnpm build 통과
- [x] pnpm test 통과
- [x] pnpm lint 통과 (warn 허용, error 0)
- [ ] coding-rules-audit.md 상태를 completed로 변경
