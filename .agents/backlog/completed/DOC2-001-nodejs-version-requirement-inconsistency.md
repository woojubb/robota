---
title: 'DOC2-001: Node.js 버전 요구사항 3중 불일치 — README/docs/CLI 간 다른 메시지'
status: done
created: 2026-05-10
priority: high
urgency: now
area: documentation
source: pm-prelaunch-report-2026-05-10-v2 (PM-C-002, PM-I-003)
---

## Problem

세 문서에서 Node.js 버전 요구사항이 모두 다르다:

| 문서                                 | 표기                                               |
| ------------------------------------ | -------------------------------------------------- |
| `/README.md` (루트, GitHub 진입점)   | "Node.js 18+ required"                             |
| `/content/getting-started/README.md` | "Node.js: 18.0.0 or higher (recommended: 22.14.0)" |
| `/packages/agent-cli/README.md`      | "Node.js **22 or higher** is required"             |
| `bin/robota.cjs` (실제 강제 버전)    | `>= 22` — 22 미만이면 즉시 `process.exit(1)`       |

또한 `content/getting-started/README.md`는 같은 문서 내에서도 Prerequisites 섹션(18.0.0+)과
System Requirements 박스(22+)가 충돌한다.

GitHub에서 발견한 사용자가 "18+ required"를 보고 Node 18 환경에서 설치 → 실행 시 바이너리 오류.

## Required Change

### 1. 루트 README.md

"Node.js 18+ required" → "Node.js **22 or higher** required"

### 2. content/getting-started/README.md

Prerequisites 섹션을 CLI와 SDK로 분리:

```markdown
## Prerequisites

**Robota CLI** requires **Node.js 22 or higher** (enforced at runtime).

**Robota SDK** requires Node.js 18 or higher (22 recommended).

Check your version:
\`\`\`bash
node --version # Must be v22+ for CLI
\`\`\`
```

같은 문서 내 "System Requirements" 박스도 통일.

### 3. 검토 대상

- `/apps/agent-web/README.md` — 있다면 버전 표기 확인
- `/apps/agent-server/README.md` — Node 18 표기 여부 확인

## Scope

- `/README.md` — Node.js 버전 표기 수정
- `/content/getting-started/README.md` — CLI/SDK 요구사항 분리 명시
- `packages/agent-cli/README.md` — 이미 올바름 (22+), 다른 문서와 일관성만 확인

## Test Plan

- 각 문서에서 Node.js 버전 요구사항 grep 후 일관성 확인:
  ```bash
  rg -n "Node.js|node.js|nodejs" README.md content/getting-started/README.md packages/agent-cli/README.md
  ```
- `bin/robota.cjs`의 실제 강제 버전(22)과 일치 확인

## User Execution Test Scenarios

Not applicable — 문서 전용 변경. 외부 관찰 가능한 CLI/TUI 동작 없음.

## Verification Evidence

변경 후 다음 grep 결과를 기록:

```bash
rg -n "18\+" README.md content/getting-started/README.md packages/agent-cli/README.md
# Expected: 결과 없음 (루트 README의 18+ 제거됨)

rg -n "22" README.md content/getting-started/README.md packages/agent-cli/README.md
# Expected: 모든 문서에서 Node.js 22+ 요구사항 확인
```

**Evidence:** `content/getting-started/README.md:5` 수정 — "18.0.0 or higher (recommended: 22.14.0)" → "Node.js 22 or higher — required for Robota CLI; SDK supports Node.js 18+ (22 recommended)". 루트 README.md는 이미 "Node.js 22+ required"로 올바름. 3개 문서 모두 Node.js 22+ 일관 표기 확인.
