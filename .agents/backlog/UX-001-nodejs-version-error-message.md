---
title: 'UX-001: Node.js 22+ 요구사항 에러 메시지 개선 및 안내 강화'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: ux
source: pm-prelaunch-report-2026-05-10
---

## Problem

`packages/agent-cli/package.json`의 `engines.node >= 22.0.0` 요구사항은 진입장벽이 높다.
Node 22는 2024년 10월에 LTS로 진입했으나, 많은 개발자 환경에 Node 18 또는 20이 설치되어 있다.

현재 Node 18/20에서 `robota` 실행 시 npm engine 검사 경고가 나오거나, 런타임에 구문 오류로
크래시할 수 있다. 사용자는 왜 실패하는지 즉각적으로 알기 어렵다.

추가로 README에 버전 확인 명령이 충분히 강조되어 있지 않다.

## Required Change

### 1. bin.ts 진입점에서 Node 버전 사전 확인

```typescript
// packages/agent-cli/src/bin.ts 상단
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(
    `\n  Robota requires Node.js 22 or higher.\n` +
      `  Current version: ${process.versions.node}\n` +
      `  Install Node 22+: https://nodejs.org/en/download\n` +
      `  Or use nvm: nvm install 22 && nvm use 22\n`,
  );
  process.exit(1);
}
```

### 2. README 설치 섹션에 버전 확인 명령 강조

```markdown
### Prerequisites

Node.js 22 or higher is required.

\`\`\`bash
node --version # Must be v22 or higher
\`\`\`

If your version is lower, install via [nvm](https://github.com/nvm-sh/nvm):
\`\`\`bash
nvm install 22
nvm use 22
\`\`\`
```

### 3. .nvmrc 파일 추가 (선택)

프로젝트 루트 또는 `packages/agent-cli/`에 `.nvmrc` 파일 추가:

```
22
```

## Scope

- `packages/agent-cli/src/bin.ts` — 버전 사전 확인 추가
- `packages/agent-cli/README.md` — Prerequisites 섹션 강화
- `packages/agent-cli/.nvmrc` — 새 파일 (선택)

## Test Plan

- Node 20 환경에서 `robota` 실행 시 명확한 에러 메시지 확인 (CI 매트릭스 테스트)
- 에러 메시지에 설치 가이드 URL 포함 확인

## User Execution Test Scenarios

**Prerequisites:** Node 18 또는 20이 설치된 환경 (nvm으로 전환 가능)

**Scenario — 낮은 Node 버전에서 실행:**

```bash
nvm use 20
robota --version
```

**Expected observable result (수정 후):**

```
  Robota requires Node.js 22 or higher.
  Current version: v20.x.x
  Install Node 22+: https://nodejs.org/en/download
  Or use nvm: nvm install 22 && nvm use 22
```

Exit code: 1

**현재 동작:** npm 경고 또는 구문 오류 스택 트레이스

**Cleanup:**

```bash
nvm use 22  # 원래 버전으로 복원
```

**Evidence:** (구현 후 채울 것)
