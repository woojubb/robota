---
title: 'CLI-002: readability-focused lint rules — agent-cli first, then monorepo-wide'
status: in-progress
created: 2026-05-17
priority: high
urgency: soon
area: packages/agent-cli → monorepo-wide
---

## Problem

`agent-cli`는 아키텍처 분리(CLI-001)는 완료됐지만, 사람이 코드를 읽을 때 마찰이 생기는 지점들이 있다.

1. **Import 순서가 없음** — builtin / external / internal / type import가 뒤섞여 있어 파일 상단을 스캔하는 데 비용이 든다
2. **`import type` 미분리** — value import와 type import를 같은 구문에 섞어 쓴다. 무엇이 런타임 의존인지 바로 보이지 않는다
3. **반환 타입 미표기** — export 함수들 일부가 반환 타입을 생략한다. API 시그니처를 읽으려면 구현을 따라가야 한다
4. **함수 길이 초과 경고 방치** — `cli.ts`, `print-mode.ts`, `cli-args.ts`의 `max-lines-per-function` 경고 3개가 이미 존재한다
5. **Magic number** — `tui-mode.ts`의 `5000`(shellExec timeout), `cli-args.ts` 파싱 상수 등이 이름 없이 박혀 있다

## Goal

`agent-cli`에 가독성 특화 lint 규칙을 먼저 적용하고, 통과시킨 뒤 다른 패키지에 점진적으로 확장한다.

---

## Phase 1 — agent-cli 적용

### Step 1: `eslint-plugin-import` 설치

```bash
pnpm add -Dw eslint-plugin-import @typescript-eslint/eslint-plugin
```

루트 `package.json` devDependencies에 추가.

### Step 2: agent-cli 전용 `.eslintrc.json` override 추가

`packages/agent-cli/.eslintrc.json`에 agent-cli 전용 규칙 블록을 추가한다.

```jsonc
{
  "extends": "../../tsconfig.eslint.json",
  "plugins": ["import"],
  "rules": {
    // 1. Import 순서
    "import/order": [
      "warn",
      {
        "groups": ["builtin", "external", "internal", ["parent", "sibling", "index"], "type"],
        "newlines-between": "always",
        "alphabetize": { "order": "asc", "caseInsensitive": true },
      },
    ],

    // 2. type-only import 분리
    "@typescript-eslint/consistent-type-imports": [
      "warn",
      { "prefer": "type-imports", "fixStyle": "separate-type-imports" },
    ],

    // 3. export 함수 반환 타입 명시
    "@typescript-eslint/explicit-function-return-type": [
      "warn",
      {
        "allowExpressions": true,
        "allowTypedFunctionExpressions": true,
        "allowHigherOrderFunctions": true,
        "allowDirectConstAssertionInArrowFunctions": true,
      },
    ],

    // 4. const 강제 (선언 후 재할당 없으면 const)
    "prefer-const": "warn",

    // 5. 객체 단축 표기 강제 ({ x: x } → { x })
    "object-shorthand": ["warn", "always"],
  },
}
```

### Step 3: lint 위반 수정

규칙 추가 후 발생하는 경고를 모두 수정한다.

| 파일                              | 예상 위반                                                          |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/cli.ts`                      | import 순서, consistent-type-imports, max-lines-per-function(51줄) |
| `src/modes/print-mode.ts`         | import 순서, max-lines-per-function(53줄)                          |
| `src/modes/tui-mode.ts`           | magic number(5000 → `SHELL_EXEC_TIMEOUT_MS`), import 순서          |
| `src/startup/args-to-options.ts`  | explicit-function-return-type                                      |
| `src/startup/config-phase.ts`     | import 순서                                                        |
| `src/startup/provider-startup.ts` | consistent-type-imports                                            |
| `src/utils/cli-args.ts`           | max-lines-per-function(78줄) — `parseCliArgs` 분리 필요            |

`cli-args.ts`의 `parseCliArgs` 78줄은 option 정의 블록과 결과 매핑 블록으로 분리한다:

```typescript
// before: parseCliArgs() 78줄짜리 단일 함수
// after:
function defineParseArgsOptions(): ParseArgsOptionsConfig { ... }  // ~40줄
export function parseCliArgs(): IParsedCliArgs { ... }             // ~20줄
```

### Step 4: lint 0 errors, 0 warnings 확인

```bash
pnpm --filter @robota-sdk/agent-cli lint
```

경고 없이 통과해야 한다.

---

## Phase 2 — 점진적 모노레포 확장

agent-cli 적용이 안정화된 후 패키지별로 순서대로 적용한다.

| 순서 | 패키지            | 이유                                   |
| ---- | ----------------- | -------------------------------------- |
| 1    | `agent-framework` | 가장 많이 읽히는 코어 패키지           |
| 2    | `agent-command`   | agent-cli와 가장 가까운 소비자         |
| 3    | `agent-transport` | TUI/headless 진입점                    |
| 4    | 나머지 packages/  | 알파벳순                               |
| 5    | apps/             | 마지막 (앱은 규칙 완화 overrides 유지) |

각 패키지마다:

1. 해당 패키지 `.eslintrc.json`에 rules 블록 추가
2. 위반 수정
3. `pnpm --filter <pkg> lint` 0 warnings 확인
4. 커밋

Phase 2는 별도 브랜치에서 패키지 단위로 PR을 쪼개서 머지한다.

---

## Acceptance Criteria

### Phase 1 완료 기준

- [x] `pnpm --filter @robota-sdk/agent-cli lint` — errors 0, warnings 0
- [x] `pnpm --filter @robota-sdk/agent-cli typecheck` 통과
- [x] `pnpm --filter @robota-sdk/agent-cli test` 통과 (67 tests)
- [x] `magic number` 상수 이름 부여 완료 (`SHELL_EXEC_TIMEOUT_MS`)
- [x] `parseCliArgs` max-lines-per-function 위반 해소 (`PARSE_ARGS_CONFIG` + `mapParsedValues` 분리)

### Phase 2 완료 기준

- [ ] `pnpm lint` (전체) — errors 0, warnings 0
- [ ] 모든 패키지 typecheck + test 통과

## User Execution Test Scenarios

### Scenario 1: agent-cli lint clean

- Prerequisites: 없음
- Steps: `pnpm --filter @robota-sdk/agent-cli lint`
- Expected: `0 problems (0 errors, 0 warnings)`
- Evidence: 2026-05-17 확인 — `(Bash completed with no output)` = 0 problems. Commit `3ce054c76`

### Scenario 2: import 순서 자동 수정 확인

- Prerequisites: Phase 1 완료
- Steps: import 순서가 틀린 파일에 `// eslint-disable-next-line import/order` 없이 `pnpm --filter @robota-sdk/agent-cli lint --fix` 실행 후 git diff 확인
- Expected: import 블록이 builtin → external → internal → type 순서로 자동 정렬됨
- Evidence: 2026-05-17 확인 — `eslint --fix` 실행 후 106개 위반 자동 수정됨 (15개 파일). import/order 정렬 및 type import 분리 확인.
