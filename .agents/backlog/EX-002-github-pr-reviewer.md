---
title: 'EX-002: GitHub PR 자동 리뷰어 — GitHub Actions + agent-framework'
status: todo
created: 2026-05-25
priority: high
urgency: soon
area: examples/github-pr-reviewer
depends_on: []
---

## Background

PR 자동 리뷰는 개발 팀이 가장 즉각적으로 가치를 느끼는 AI 활용 사례다.
GitHub Actions 워크플로우에서 `agent-framework`를 직접 실행해
PR diff를 분석하고 리뷰 코멘트를 자동으로 달 수 있음을 보여준다.

서버 없이 순수 Node.js 스크립트로 동작한다는 것이 CLI 예제와 다른 점.

## 구현 목표

```
examples/github-pr-reviewer/
  package.json
  tsconfig.json
  .env.example
  README.md
  .github/
    workflows/
      pr-review.yml      — GitHub Actions 워크플로우
  src/
    review.ts            — PR diff 가져오기 → AI 분석 → 코멘트 게시
```

### 핵심 패턴

1. `@octokit/rest`로 PR diff 가져오기
2. `createQuery`로 AI에게 diff 전달 + 리뷰 요청
3. 결과를 GitHub PR Review 코멘트로 게시
4. GitHub Actions `pull_request` 이벤트에서 자동 실행

### GitHub Actions 워크플로우

```yaml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: node dist/review.js
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
```

### 보여줄 것

- 서버리스/스크립트 형태로 agent-framework 실행
- CI/CD 파이프라인 내 AI 통합
- GitHub API 연동

## Test Plan

- `npx tsx src/review.ts` 실행 시 PR 코멘트 생성 확인

## User Execution Test Scenarios

### Scenario 1: 로컬 PR 리뷰 실행

**Steps:**

```bash
ANTHROPIC_API_KEY=... GITHUB_TOKEN=... PR_NUMBER=1 \
  npx tsx src/review.ts
```

**Expected:** PR에 AI 리뷰 코멘트가 게시됨
