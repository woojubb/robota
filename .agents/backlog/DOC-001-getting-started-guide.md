---
title: 'DOC-001: 공개 docs 사이트 Getting Started 가이드 추가'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: docs
source: pm-prelaunch-report-2026-05-10
---

## Problem

`apps/docs/` VitePress 사이트(`robota.io` 연결)에 일반 사용자용 Getting Started 가이드가 없다.
현재는 기술 SPEC.md 파일들만 빌드되어 배포된다. 새 사용자가 처음 설치부터 AI와 대화하기까지의
단계를 안내하는 문서가 공개 사이트에 존재하지 않는다.

이는 PM 보고서에서 출시 전 P1 항목으로 분류되었다. 코드 품질과 기능 완성도는 높지만,
사용자가 제품을 발견하고 시작하는 단계의 마찰이 크다.

## Required Change

`apps/docs/docs/guide/` 디렉토리에 다음 문서 추가:

### 1. `getting-started.md` — 5분 Quick Start

```markdown
# Getting Started

## Installation

\`\`\`bash
npm install -g @robota-sdk/agent-cli

# or

pnpm add -g @robota-sdk/agent-cli
\`\`\`

## First Run

\`\`\`bash
robota
\`\`\`

On first run, you'll be asked to choose a provider and enter your API key.

## Providers

- **Anthropic (Claude)** — Get API key at https://console.anthropic.com
- **OpenAI** — Get API key at https://platform.openai.com
- **DeepSeek** — Get API key at https://platform.deepseek.com
- ...

## Basic Usage

Just type your question and press Enter...
```

### 2. `providers.md` — 프로바이더 설정 가이드

각 지원 프로바이더(Anthropic, OpenAI, DeepSeek, Qwen, Gemma/LM Studio, Gemini)별 설정 방법.

### 3. `commands.md` — 주요 슬래시 커맨드 레퍼런스

| Command     | Description           |
| ----------- | --------------------- |
| `/help`     | Show help             |
| `/model`    | Switch model          |
| `/provider` | Switch provider       |
| `/memory`   | Manage project memory |
| ...         | ...                   |

### 4. VitePress 네비게이션에 가이드 섹션 추가

`apps/docs/.vitepress/config.ts`에 Guide 사이드바 추가.

## Scope

- `apps/docs/docs/guide/getting-started.md` — 새 파일
- `apps/docs/docs/guide/providers.md` — 새 파일
- `apps/docs/docs/guide/commands.md` — 새 파일
- `apps/docs/.vitepress/config.ts` — 사이드바 네비게이션 업데이트

## Test Plan

- `pnpm --filter docs build` 성공 확인
- 빌드된 HTML에서 가이드 페이지 존재 확인
- 내부 링크 깨짐 없음 확인

## User Execution Test Scenarios

**Prerequisites:** `apps/docs` 빌드 완료, 로컬 서버 실행

**Scenario — 문서 사이트에서 Getting Started 접근:**

```bash
pnpm --filter docs dev
# 브라우저에서 http://localhost:5173/guide/getting-started 접속
```

**Expected observable result:**

- Getting Started 페이지가 정상 렌더링됨
- 설치 명령, 첫 실행, 프로바이더 설정 섹션이 모두 존재
- 좌측 사이드바에 Guide 섹션이 나타남

**Cleanup:** 서버 종료 (`Ctrl+C`)

**Evidence:** (구현 후 채울 것)
