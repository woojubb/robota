# 시작하기

> **베타 소프트웨어** — Robota CLI는 현재 `3.0.0-beta` 버전입니다. 핵심 기능은 안정적이지만 정식 릴리스 전에 API가 변경될 수 있습니다. [이슈 보고](https://github.com/woojubb/robota/issues).

## 어떤 경로가 적합한가요?

**"지금 바로 터미널에서 코딩 어시스턴트를 사용하고 싶다"**
→ [CLI 빠른 시작](#빠른-시작--cli) — 2분, API 키 필요

**"앱에 챗봇이나 AI 기능을 만들고 싶다"**
→ [첫 번째 에이전트](#1-간단한-대화형-에이전트-만들기) — 10분

**"코드를 다시 작성하지 않고 AI 프로바이더를 바꾸고 싶다"**
→ [프로바이더 전환](#3-프로바이더-동적-전환) — 5분

**"직접 만든 도구나 앱에 AI 어시스턴트를 임베드하고 싶다"**
→ [SDK 사용(InteractiveSession)](#4-프로젝트-인식-세션sdk) — 15분

**"API 키 없이 무료로 시도하고 싶다"**
→ [LM Studio로 로컬 모델 사용](#api-키-없이-로컬-모델로-시도하세요) — 10분

---

## API 키 없이? 로컬 모델로 시도하세요

[LM Studio](https://lmstudio.ai/) 설치 → 원하는 모델 다운로드 → 로컬 서버 활성화

```bash
npx @robota-sdk/agent-cli  # 프롬프트에서 "LM Studio" 선택 — API 키 불필요
```

---

## 사전 요구사항

- **Node.js 22 이상** — Robota CLI에 필요. SDK는 Node.js 18+ 지원(22 권장)
- **AI 프로바이더 API 키**: Anthropic, OpenAI, DeepSeek, Gemini, Qwen 등 — _또는_ LM Studio 로컬 사용(키 불필요)

## 설치

용도에 맞는 패키지를 선택하세요:

### 바로 사용 가능한 코딩 어시스턴트가 필요해요

```bash
# 설치 없이 바로 실행
npx @robota-sdk/agent-cli

# 지속적으로 사용하려면 전역 설치
npm install -g @robota-sdk/agent-cli
```

### 커스텀 AI 에이전트를 만들고 싶어요

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider
```

### 도구 호출(함수 도구)이 필요해요

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-tools @robota-sdk/agent-provider
```

## 빠른 시작 · CLI

```bash
# 설치 없이 바로 실행
npx @robota-sdk/agent-cli

# 전역 설치
npm install -g @robota-sdk/agent-cli
robota
```

처음 실행 시 안내에 따라 프로바이더 선택과 API 키 설정을 진행합니다.

**한 줄로 워크플로우 작성하기.** 설정을 마친 뒤에는 여러 단계로 이루어진 작업을 평범한 자연어로
설명하면 CLI가 이를 만들어 바로 실행합니다:

```bash
robota
> /workflows create "열린 이슈를 가져와 각각 요약한 뒤 다이제스트를 작성해줘"
```

`/workflows create`는 활성 프로바이더에게 워크플로우 설계를 요청하고, 이를
`.workflows/<name>.json`에 저장한 다음 즉시 실행합니다. 자세한 내용은
[CLI 레퍼런스](/guide/cli#workflows-workflows)를 참고하세요.

### 지원 프로바이더

| 프로바이더         | 모델 예시                          | API 키                                                   |
| ------------------ | ---------------------------------- | -------------------------------------------------------- |
| Anthropic (Claude) | claude-opus-4-6, claude-sonnet-4-6 | [console.anthropic.com](https://console.anthropic.com)   |
| OpenAI             | gpt-4o                             | [platform.openai.com](https://platform.openai.com)       |
| DeepSeek           | deepseek-chat                      | [platform.deepseek.com](https://platform.deepseek.com)   |
| Qwen (Alibaba)     | qwen-plus                          | [dashscope.aliyuncs.com](https://dashscope.aliyuncs.com) |
| Gemini             | gemini-2.0-flash                   | [aistudio.google.com](https://aistudio.google.com)       |
| LM Studio (로컬)   | 모든 로컬 모델                     | localhost — 키 불필요                                    |

### 시스템 요구사항

- **Node.js 22 이상** — `node --version`으로 확인하세요
- macOS, Linux 또는 Windows(WSL 권장)

## 첫 번째 에이전트

### 1. 간단한 대화형 에이전트 만들기

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful coding assistant.',
});

const response = await agent.run('TypeScript 제네릭이 무엇인가요?');
console.log(response);
```

### 2. 도구를 사용하는 에이전트

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { z } from 'zod';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const weatherTool = createZodFunctionTool(
  'get_weather',
  'Get current weather for a city',
  z.object({
    city: z.string().describe('City name'),
  }),
  async ({ city }) => ({
    data: JSON.stringify({ city, temperature: 22, condition: 'sunny' }),
  }),
);

const agent = new Robota({
  name: 'WeatherBot',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You help users check the weather.',
  tools: [weatherTool],
});

// 필요 시 에이전트가 get_weather를 자동 호출합니다
const response = await agent.run('서울 날씨가 어때?');
console.log(response);
```

### 3. 프로바이더 동적 전환

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [
    new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
  ],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
});

// Claude로 시작
let response = await agent.run('안녕하세요!');

// 대화 도중 OpenAI로 전환
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
response = await agent.run('대화를 이어가 주세요.');
```

### 4. 프로젝트 인식 세션(SDK)

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));

session.on('complete', ({ response }) => {
  console.log('\n--- 전체 응답 ---');
  console.log(response);
});

// InteractiveSession은 프로젝트 컨텍스트/설정을 로드한 뒤 권한, 훅, 컴팩션,
// 커맨드, 영속성, 트랜스포트를 제공합니다.
await session.submit('이 프로젝트의 아키텍처를 설명해줘');
```

### 5. CLI 사용

```bash
# 인터랙티브 TUI
robota

# 원샷
robota -p "이 프로젝트의 모든 TODO 주석을 나열해줘"

# 모델 오버라이드
robota --model claude-opus-4-6
```

## 다음 단계

> 아래 가이드는 아직 한국어 번역이 없어 영어 문서로 연결됩니다.

- [Building Agents](/guide/building-agents) — agent-core 에이전트 패턴
- [Using the SDK](/guide/sdk) — InteractiveSession, 트랜스포트, 세션, createQuery()
- [CLI Reference](/guide/cli) — 전체 CLI 사용 가이드. [`/workflows create`](/guide/cli#workflows-workflows) 자연어 워크플로우 작성 포함
- [Architecture](/guide/architecture) — 패키지 계층과 설계
- [Providers Reference](/guide/providers) — 전체 프로바이더, 설정 옵션, 모델 이름
- [Error Handling](/guide/error-handling) — 에러 타입, 재시도 패턴, 모범 사례
- [Migration Guide](/guide/migration) — v2.x → 3.0.0 업그레이드

## 문제 해결

**macOS Terminal.app + 한글/CJK 입력**: IME 입력이 macOS Terminal.app을 크래시시킬 수 있습니다. 대신 **[iTerm2](https://iterm2.com/)** 를 사용하세요. Ink + Terminal.app의 알려진 이슈입니다.

**Node.js 버전**: Robota CLI는 Node.js 22+ 가 필요합니다. `node --version`으로 확인하세요. [Volta](https://volta.sh/) 또는 [nvm](https://github.com/nvm-sh/nvm)으로 버전을 관리하세요.

**API 키를 찾을 수 없음**: 환경 변수로 키를 설정(`export ANTHROPIC_API_KEY=...`)하거나 `robota`를 실행해 인터랙티브 설정을 따르세요.
