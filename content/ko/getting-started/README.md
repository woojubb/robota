# 시작하기

> **베타 소프트웨어** — Robota CLI는 현재 `3.0.0-beta` 버전입니다. 핵심 기능은 안정적이지만 정식 릴리스 전에 API가 변경될 수 있습니다. [이슈 보고](https://github.com/woojubb/robota/issues).

## 어떤 경로가 적합한가요?

**"지금 바로 터미널에서 코딩 어시스턴트를 사용하고 싶다"**
→ [CLI 빠른 시작](#빠른-시작--cli) — 2분, API 키 필요

**"앱에 챗봇이나 AI 기능을 만들고 싶다"**
→ [첫 번째 에이전트 (5줄)](#1-간단한-대화형-에이전트-만들기) — 10분

**"코드를 다시 작성하지 않고 AI 프로바이더를 바꾸고 싶다"**
→ [프로바이더 전환](#3-프로바이더-동적-전환) — 5분

**"API 키 없이 무료로 시도하고 싶다"**
→ [LM Studio로 로컬 모델 사용](#api-키-없이-로컬-모델-사용) — 10분

---

## API 키 없이? 로컬 모델로 시도하세요

[LM Studio](https://lmstudio.ai/) 설치 → 원하는 모델 다운로드 → 로컬 서버 활성화

```bash
npx @robota-sdk/agent-cli  # 프롬프트에서 "LM Studio" 선택 — API 키 불필요
```

---

## 빠른 시작 · CLI

### 1. 설치

```bash
# npm
npm install -g @robota-sdk/agent-cli

# pnpm
pnpm add -g @robota-sdk/agent-cli

# 설치 없이 바로 실행
npx @robota-sdk/agent-cli
```

### 2. 첫 실행

```bash
robota
```

처음 실행 시 안내에 따라 AI 프로바이더(Anthropic, OpenAI 등)를 설정하세요.

### 3. 프로바이더 설정

`/provider` 커맨드로 Anthropic, OpenAI, DeepSeek, Gemini, 또는 로컬 모델을 설정할 수 있습니다.

---

## 1. 간단한 대화형 에이전트 만들기

```typescript
import { Anthropic } from '@robota-sdk/anthropic';
import { createAgent } from '@robota-sdk/agent-core';

const agent = createAgent({
  providers: [new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: 'claude-sonnet-4-5',
});

const response = await agent.run('안녕하세요! 간단한 Python 스크립트 작성해줘.');
console.log(response);
```

---

## 2. 도구 사용 에이전트

```typescript
import { Anthropic } from '@robota-sdk/anthropic';
import { createAgent } from '@robota-sdk/agent-core';

const agent = createAgent({
  providers: [new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: 'claude-sonnet-4-5',
  tools: [
    {
      name: 'get_weather',
      description: '특정 도시의 현재 날씨를 조회합니다',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '도시 이름' },
        },
        required: ['city'],
      },
      execute: async ({ city }: { city: string }) => {
        return `${city}의 현재 날씨: 맑음, 22°C`;
      },
    },
  ],
});

const response = await agent.run('서울 날씨가 어때?');
console.log(response);
```

---

## 3. 프로바이더 동적 전환

```typescript
import { Anthropic } from '@robota-sdk/anthropic';
import { OpenAI } from '@robota-sdk/openai';
import { createAgent } from '@robota-sdk/agent-core';

const agent = createAgent({
  providers: [
    new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  ],
  defaultModel: 'claude-sonnet-4-5',
});

// Anthropic으로 실행
const r1 = await agent.run('안녕!', { model: 'claude-sonnet-4-5' });

// OpenAI로 전환
const r2 = await agent.run('안녕!', { model: 'gpt-4o' });
```

---

## 다음 단계

- [가이드](/ko/guide) — 아키텍처와 고급 기능
- [패키지 참조](/ko/packages) — API 문서
- [예제](/ko/examples) — 실제 코드 예제
