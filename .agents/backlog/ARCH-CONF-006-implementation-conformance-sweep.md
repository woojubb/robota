---
title: 'ARCH-CONF-006: 아키텍처 핵심 제약 구현체 정합성 전체 검증'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: implementation-conformance
depends_on:
  - ARCH-CONF-001
  - ARCH-CONF-002
  - ARCH-CONF-003
  - ARCH-CONF-004
---

## Problem

아키텍처 맵(SSOT) → SPEC.md → 구현체 순서의 SSOT 흐름에서 구현체 계층이 아직 검증되지 않았다. 아키텍처 규칙이 실제 코드에서 준수되는지 체계적 점검이 필요하다.

## Required Verification Checks

### 1. agent-core ZERO deps (구현 검증)

```bash
cat packages/agent-core/package.json | jq '.dependencies // {} | keys[] | select(startswith("@robota-sdk/"))'
```

예상: 출력 없음

### 2. agent-sdk React-free (구현 검증)

```bash
grep -r "from 'react'" packages/agent-sdk/src/ --include="*.ts" --include="*.tsx"
grep "react" packages/agent-sdk/package.json
```

예상: 출력 없음

### 3. agent-sessions는 agent-runtime에 의존하지 않음 (역방향 금지)

```bash
cat packages/agent-sessions/package.json | jq '.dependencies // {} | keys[] | select(contains("agent-runtime"))'
```

예상: 출력 없음

### 4. agent-plugin-\* 의존성 방향 (agent-core만 허용)

```bash
for pkg in packages/agent-plugin-*/; do
  echo "=== $pkg ==="; cat "$pkg/package.json" | jq '.dependencies // {} | keys[] | select(startswith("@robota-sdk/") and (contains("agent-core") | not))'
done
```

예상: 출력 없음 (agent-core만 허용)

### 5. agent-cli는 agent-sessions를 직접 import하지 않음

```bash
grep -r "@robota-sdk/agent-sessions" packages/agent-cli/src/ --include="*.ts"
```

예상: 출력 없음 (harness에서도 검사 중)

### 6. agent-sdk는 agent-command-\* 패키지를 import하지 않음

```bash
grep -r "@robota-sdk/agent-command-" packages/agent-sdk/src/ --include="*.ts"
```

예상: 출력 없음

### 7. agent-command-\* 패키지는 agent-cli를 import하지 않음

```bash
grep -r "@robota-sdk/agent-cli" packages/agent-command-*/src/ --include="*.ts"
```

예상: 출력 없음

## Test Plan

위 7개 검사를 모두 실행하고 각 결과가 예상과 일치하는지 확인한다. 불일치 발견 시 별도 픽스 백로그를 생성한다.

추가: `pnpm harness:verify -- --scope packages/agent-core packages/agent-sdk packages/agent-sessions packages/agent-runtime`

## User Execution Test Scenarios

Not applicable — verification-only task. Implementation fixes (if any) are tracked in separate fix backlog items.

## Test Plan Execution Evidence (2026-05-10)

All 7 verification checks executed and passed:

1. **agent-core ZERO deps** → `OK — no @robota-sdk/* prod/peer deps`
2. **agent-sdk React-free** → `OK — no 'react' imports in agent-sdk/src`
3. **agent-sessions does NOT depend on agent-runtime** → `OK — no agent-runtime dependency`
4. **agent-plugin-\* only depends on agent-core** → All 9 plugins: OK
5. **agent-cli does NOT import agent-sessions directly** → `OK — no agent-sessions in agent-cli/src`
6. **agent-sdk does NOT import agent-command-\*** → `OK — no agent-command-* imports in agent-sdk/src`
7. **agent-command-\* does NOT import agent-cli** → `OK — no agent-cli imports in agent-command-*`

Additionally verified via `pnpm harness:scan`:

- `harness:scan:deps` (check-dependency-direction.mjs) → ✅ No dependency direction violations
- `harness:scan:sdk-react-free` (check-sdk-react-free.mjs) → ✅ agent-sdk is React-free
- `harness:scan:publish` → ✅ agent-core has zero @robota-sdk dependencies
