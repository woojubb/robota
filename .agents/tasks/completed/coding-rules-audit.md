# Coding Rules & Skills Audit

## Status: completed

## Priority: high

## Scope

AGENTS.md mandatory rules 49개 + skills 27개 전수 조사.
각 항목에 대해: (1) 보편성 검증, (2) 대안/개선 제안, (3) 누락 항목 추천.

---

## Part 1: 기존 규칙 검토 — 개선 제안

### P1-01. `I*`/`T*` prefix naming convention

**현재 규칙:** `I*` prefix는 interface 전용, `T*` prefix는 type alias 전용.

**검토 의견:**
- Hungarian notation 계열. C#/Java에서 유래, TypeScript 초기에 많이 사용됨.
- **현재 업계 추세는 prefix 제거 방향.** Google TS Style Guide, Airbnb, Angular Style Guide 모두 `I` prefix를 사용하지 않음.
- Microsoft 자체 TypeScript 코드베이스에서도 비일관적.
- IDE hover와 자동완성이 발달하면서 prefix의 정보 가치가 감소.

**대안:**
- prefix 없이 서술적 이름 사용 (`AgentConfig`, `PortValueType`)
- interface와 type alias 구분이 필요한 곳은 파일 구조나 JSDoc으로 해결

**판단 기준:** 프로젝트 일관성 vs 업계 표준. 이미 대규모 코드베이스에 적용되어 있으므로 변경 비용이 높음.

**제안:** [ ] 유지 / [ ] 점진적 제거 / [ ] 신규 코드만 prefix-free

---

### P1-02. No Fallback Policy → Result type 의무화

**현재 규칙:** Fallback 금지, terminal failure는 terminal 유지, retry는 explicit policy gate만 허용.

**검토 의견:**
- 의도가 좋고 "fail fast" 철학에 충실.
- 그러나 **실행 수단이 스킬에만 있고(effect-style-error-modeling) mandatory rule에는 없음.**
- `Result<T, E>` 패턴이 스킬에서는 권장되지만 규칙에서는 `throw` vs `Result` 선택이 명시되지 않음.

**제안:** No Fallback Policy 규칙에 한 줄 추가:
```
- Public domain functions that can fail MUST return Result<T, E>. Throwing is reserved for truly unexpected programmer errors.
```

**판단 기준:** 이미 dag-core state machine 등에서 Result 패턴 사용 중. 규칙으로 격상하면 일관성 확보.

**제안:** [ ] 채택 / [ ] 보류 / [ ] 거부

---

### P1-03. Conventional commit subject line 80자 → 72자

**현재 규칙:** max 80 chars.

**검토 의견:**
- Git 자체 convention은 subject line 50자 권장, 강제 상한 72자.
- `git log --oneline`에서 72자 초과 시 잘림.
- GitHub PR merge commit에서도 72자가 표준.

**대안:** 72자로 축소하면 git tooling과 더 잘 맞음.

**제안:** [ ] 72자로 변경 / [ ] 80자 유지

---

### P1-04. File/function size limit를 규칙으로 격상

**현재 상태:** `package-code-review` 스킬에 300행/50행 가이드라인 존재. mandatory rule 아님.

**검토 의견:**
- 코드 리뷰에서 가장 빈번하게 언급되는 항목 중 하나.
- ESLint `max-lines`, `max-lines-per-function` 룰로 자동 강제 가능.
- 300행/50행은 합리적인 수치 (Google: 2000행, Airbnb: 없음, 일반적 권장: 200-500행).

**제안:** mandatory rule에 추가하되 lint로 강제:
```
- Production files should not exceed 300 lines. Functions should not exceed 50 lines. Exceptions require justification in code review.
```

**제안:** [ ] 규칙 격상 + lint / [ ] 스킬 유지 / [ ] 거부

---

### P1-05. Dependency direction 자동 검증

**현재 상태:** project-structure.md에 방향 규칙 존재. 수동 검증만.

**검토 의견:**
- 모노레포에서 의존성 방향 위반은 가장 흔한 아키텍처 퇴화 패턴.
- `dependency-cruiser` 또는 `madge`로 CI에서 자동 검증 가능.
- 현재 `.agents/project-structure.md`에 규칙은 있지만 기계적 검증 없음.

**제안:** `pnpm harness:scan`에 dependency-direction check 추가.

**제안:** [ ] 도구 도입 / [ ] 수동 유지 / [ ] 보류

---

### P1-06. Test coverage threshold 부재

**현재 상태:** TDD 의무화, vitest-testing-strategy 스킬 존재. 그러나 **숫자 기준 없음.**

**검토 의견:**
- TDD를 따르면 자연히 높은 coverage가 나오지만, 기계적 gate가 없으면 퇴화.
- 업계 표준: 새 코드 80% line coverage, 전체 60-70% target.
- `vitest --coverage`로 CI에서 gate 가능.

**제안:**
```
- New code must maintain ≥80% line coverage. Coverage regression is a CI blocker.
```

**제안:** [ ] threshold 도입 / [ ] TDD만으로 충분 / [ ] 보류

---

### P1-07. `as const` / `readonly` / immutability convention 부재

**현재 상태:** Value object 불변성은 DDD 스킬에서 언급. 일반적 immutability 규칙 없음.

**검토 의견:**
- 코드 리뷰에서 자주 지적: "이 파라미터를 함수 안에서 mutate하면 안 됩니다."
- `readonly` modifier, `as const`, `Readonly<T>`, `ReadonlyArray<T>` 활용.
- TypeScript strict mode에 `readonly` 강제는 포함되지 않음.

**제안:** Development Patterns에 추가:
```
- Prefer readonly properties and parameters. Mutation should be explicit and localized.
```

**제안:** [ ] 채택 / [ ] 보류 / [ ] 거부

---

## Part 2: 누락 항목 — 코드 리뷰에서 흔히 언급되지만 규칙에 없는 것

### P2-01. Cyclomatic complexity limit

**설명:** 함수의 분기 복잡도 제한. `if/else/switch/ternary` 중첩이 깊어지면 이해하기 어려움.

**업계 표준:** ESLint `complexity` 룰, 보통 10-15로 설정.

**기존 규칙과의 관계:** 50행 함수 크기 제한이 간접적으로 커버하지만, 짧은 함수도 분기가 많으면 복잡.

**제안:** [ ] ESLint complexity 룰 도입 / [ ] 불필요 / [ ] 보류

---

### P2-02. Null vs Undefined convention

**설명:** TypeScript에서 `null`과 `undefined` 모두 존재. 프로젝트마다 하나를 선호.

**업계 패턴:**
- Google TS Style Guide: `undefined` 선호, `null` 지양
- 많은 프로젝트: API 경계에서 `null` (JSON 호환), 내부에서 `undefined`

**현재 상태:** strictNullChecks는 strict mode에 포함. 그러나 null vs undefined 선호가 명시되지 않음.

**제안:** [ ] undefined 선호 규칙 추가 / [ ] null/undefined 구분 규칙 추가 / [ ] 불필요

---

### P2-03. Parameter mutation 금지

**설명:** 함수가 받은 객체를 직접 수정하면 호출자에게 예상치 못한 부작용 발생.

**업계 표준:** ESLint `no-param-reassign` 룰. React/Redux 생태계에서 필수.

**현재 상태:** "Separate core behavior from side concerns" 규칙이 간접적으로 커버하지만, parameter mutation을 명시적으로 금지하지 않음.

**제안:** [ ] Development Patterns에 추가 / [ ] lint 룰만 / [ ] 불필요

---

### P2-04. Dead code / unused exports 감지

**설명:** 사용되지 않는 export, 도달 불가능한 코드, 사용되지 않는 변수.

**업계 표준:** `ts-prune`, `knip` 등으로 unused exports 감지. ESLint `no-unused-vars`.

**현재 상태:** 명시적 규칙 없음. SSOT 스캔이 중복은 감지하지만 unused는 감지하지 않음.

**제안:** [ ] knip 도구 도입 / [ ] lint 룰 강화 / [ ] 불필요

---

### P2-05. Structured logging level guide

**설명:** 로그 레벨 사용 기준. 어떤 상황에 `debug`/`info`/`warn`/`error`를 쓰는지.

**업계 표준:**
- `error`: 즉시 대응 필요한 장애
- `warn`: 비정상이지만 자동 복구 가능
- `info`: 주요 비즈니스 이벤트 (시작/완료)
- `debug`: 개발 디버깅용

**현재 상태:** DI로 logger 주입 의무화. 그러나 레벨 사용 기준 없음. LoggingPlugin에서 레벨 필터링은 있지만 "언제 무엇을" 가이드 없음.

**제안:** [ ] 로깅 가이드 스킬 추가 / [ ] 불필요 / [ ] 보류

---

### P2-06. Accessibility (a11y) rules

**설명:** 웹 UI의 키보드 내비게이션, ARIA 속성, 스크린 리더 호환성.

**업계 표준:** `eslint-plugin-jsx-a11y`, WCAG 2.1 AA level.

**현재 상태:** Tailwind CSS만 규칙 존재. 접근성 언급 없음.

**적용 범위:** `apps/web`, `packages/dag-designer` 등 UI 패키지에만 해당.

**제안:** [ ] a11y lint 룰 추가 / [ ] 보류 (UI 성숙도 후) / [ ] 해당없음

---

### P2-07. Dependency security scanning

**설명:** 의존성 패키지의 알려진 취약점 감지.

**업계 표준:** `npm audit`, `pnpm audit`, Dependabot/Renovate 자동화.

**현재 상태:** 규칙이나 CI 파이프라인에 없음.

**제안:** [ ] pnpm audit를 CI에 추가 / [ ] Dependabot 설정 / [ ] 보류

---

### P2-08. API error response 표준 (RFC 7807)

**설명:** HTTP API가 에러를 반환할 때의 표준 형식.

**업계 표준:** RFC 7807 Problem Details. `{ type, title, status, detail, instance }`.

**현재 상태:** dag-api에 `IProblemDetails` 존재하지만 프로젝트 전체 규칙 아님.

**제안:** [ ] API 에러 표준 규칙화 / [ ] 현재 범위 유지 / [ ] 보류

---

### P2-09. Graceful shutdown pattern

**설명:** 프로세스 종료 시 진행 중인 작업 완료, 리소스 정리, 커넥션 해제.

**업계 표준:** `SIGTERM`/`SIGINT` 핸들링, 타임아웃 기반 강제 종료.

**현재 상태:** `destroy()` 메서드 패턴은 있으나, 프로세스 시그널 핸들링 규칙 없음.

**제안:** [ ] apps/ 레벨 규칙 추가 / [ ] 보류 / [ ] 해당없음

---

### P2-10. Magic number/string 금지

**설명:** 의미 없는 리터럴 값 대신 named constant 사용.

**업계 표준:** ESLint `no-magic-numbers`. 거의 모든 style guide에서 권장.

**현재 상태:** 명시적 규칙 없음. dag-core에서 상수화는 잘 되어 있지만 프로젝트 전체 규칙 아님.

**제안:** [ ] Development Patterns에 추가 / [ ] lint 룰만 / [ ] 불필요

---

## Part 3: 기존 규칙 중 보편적이고 최선인 것 (변경 불필요)

| 규칙 | 평가 |
|------|------|
| TypeScript strict mode 불변 | 업계 표준 ✓ |
| `any`/`{}` 프로덕션 금지 | 엄격하지만 정당 ✓ |
| `@ts-ignore`/`@ts-nocheck` 금지 | 보편적 ✓ |
| SSOT ownership | 아키텍처 모범 사례 ✓ |
| TDD Red-Green-Refactor | 검증된 방법론 ✓ |
| Build loop (change→build→test→fix) | 모노레포 필수 ✓ |
| Static imports default | ES modules 표준 ✓ |
| No console.* in production | 보편적 ✓ |
| DI for logging/side concerns | 아키텍처 모범 사례 ✓ |
| Conventional commits | 업계 표준 ✓ |
| Protected branch policy | Git Flow 변형, 적절 ✓ |
| Tailwind only (no inline/CSS-in-JS) | 일관성 있는 선택 ✓ |
| State machine purity (no I/O) | FSM 모범 사례 ✓ |
| Consumer-driven contract testing | 마이크로서비스 표준 ✓ |
| Functional core / Imperative shell | 검증된 아키텍처 패턴 ✓ |

---

## 의사결정 기록

아래 각 항목에 대해 사용자가 [ ] 안에 선택 표시하면 반영.

| ID | 제안 | 결정 | 비고 |
|----|------|------|------|
| P1-01 | I*/T* prefix 정책 | 신규 코드만 prefix-free | 기존 코드는 점진적 마이그레이션 |
| P1-02 | Result type 의무화 | 채택 | No Fallback Policy에 Result 규칙 추가 |
| P1-03 | Commit subject 72자 | 채택 | 80자 → 72자 변경 |
| P1-04 | File/function size 규칙화 | 규칙 격상 + lint | 300행/50행 mandatory rule |
| P1-05 | Dependency direction 자동화 | 도구 도입 | dependency-cruiser 또는 madge |
| P1-06 | Coverage threshold | 채택 | 새 코드 80% line coverage |
| P1-07 | Immutability convention | 채택 | readonly 선호 규칙 추가 |
| P2-01 | Cyclomatic complexity | 채택 | ESLint complexity 룰 도입 |
| P2-02 | Null vs undefined | 채택 | undefined 선호, API 경계에서 null 허용 |
| P2-03 | Parameter mutation 금지 | 채택 | Development Patterns에 추가 |
| P2-04 | Dead code 감지 도구 | 채택 | knip 도입 |
| P2-05 | Logging level guide | 채택 | 로깅 가이드 스킬 추가 |
| P2-06 | Accessibility rules | 채택 | a11y lint 룰 추가 (UI 패키지) |
| P2-07 | Dependency security scan | 채택 | pnpm audit CI 추가 |
| P2-08 | API error response 표준 | 채택 | RFC 7807 규칙화 |
| P2-09 | Graceful shutdown | 채택 | apps/ 레벨 규칙 추가 |
| P2-10 | Magic number/string 금지 | 채택 | Development Patterns에 추가 |
