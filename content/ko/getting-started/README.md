---
description: __PRODUCT_DISPLAY_NAME__ CLI와 SDK의 설치, 프로바이더 설정, 첫 에이전트 및 세션 사용을 단계별로 안내합니다.
---

# 시작하기

Robota provides composable TypeScript libraries and agent interfaces on the same foundation.
Our direction is [our agents developing and advancing our agents](__PROJECT_REPOSITORY_URL__/blob/develop/VISION.md);
this guide covers current capabilities. Use the SDK to build an agent or the `__PRODUCT_CLI_NAME__` CLI
as a coding assistant. This page takes you from installation to a first agent, a session with
built-in tools, and the CLI.

> **베타** — 패키지는 `3.0.0-beta` 버전으로 배포됩니다. 정식 릴리스 전에 API가 바뀔 수 있습니다.
> [이슈 보고](__PROJECT_REPOSITORY_URL__/issues).

## 어떤 경로가 적합한가요?

**"지금 바로 터미널에서 코딩 어시스턴트를 사용하고 싶다"**
→ [CLI 빠른 시작](#빠른-시작--cli) — API 키 또는 로컬 모델 필요

**"앱에 챗봇이나 AI 기능을 만들고 싶다"**
→ [첫 번째 에이전트](#1-간단한-대화형-에이전트-만들기)

**"코드를 다시 작성하지 않고 AI 프로바이더를 바꾸고 싶다"**
→ [프로바이더 전환](#3-프로바이더-동적-전환)

**"파일·셸 도구를 갖춘 AI 어시스턴트를 직접 만든 도구나 앱에 넣고 싶다"**
→ [내장 도구가 있는 세션 사용하기](#4-내장-도구가-있는-세션-사용하기)

**"API 키 없이 무료로 시도하고 싶다"**
→ [로컬 모델](#api-키가-없나요-로컬-모델로-시도하세요)

---

## API 키가 없나요? 로컬 모델로 시도하세요

[LM Studio](https://lmstudio.ai/)를 설치하고 모델을 내려받은 뒤 로컬 서버를 시작하세요(Developer 탭 →
Start Server, 주소는 `http://localhost:1234`). 그다음:

```bash
npx @robota-sdk/agent-cli  # "No — use a local model (LM Studio, no API key needed)" 선택
```

Ollama나 llama.cpp는 [Local LLM Setup](../../guide/local-llm.md)(영어)을 참고하세요.

---

## 사전 요구사항

- **Node.js 22.12 이상** — Robota CLI와 배포되는 모든 `@robota-sdk/*` 패키지가 `node >=22.12.0`을
  선언합니다. `node --version`으로 확인하세요.
- **API 키**: Anthropic, OpenAI, Gemini, DeepSeek, Qwen 중 하나 — _또는_ LM Studio, Ollama 같은 로컬 모델
  서버(키 불필요).
- **macOS, Linux 또는 Windows.** 셸 명령용 OS 샌드박스는 macOS, Linux, WSL2에서 사용할 수 있고, 네이티브
  Windows에서는 사용할 수 없습니다.

## 설치

필요한 패키지를 고르세요:

### 바로 쓸 수 있는 코딩 어시스턴트

```bash
# 설치 없이 바로 실행
npx @robota-sdk/agent-cli

# 계속 사용하려면 전역 설치
npm install -g @robota-sdk/agent-cli
```

### 커스텀 AI 에이전트

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic
```

### 도구 호출(함수 도구)

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-tools @robota-sdk/agent-provider-anthropic zod@3
```

`agent-tools`는 Zod 3를 사용합니다. 스키마가 맞도록 `zod@3`를 설치하세요.

### 내장 도구·권한·훅을 갖춘 세션

```bash
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic
```

## 빠른 시작 — CLI

```bash
# 설치 없이 바로 실행
npx @robota-sdk/agent-cli

# 계속 사용하려면 전역 설치
npm install -g @robota-sdk/agent-cli
__PRODUCT_CLI_NAME__
```

처음 실행하면 CLI가 API 키가 있는지 묻고, 프로바이더 설정, 무료 Gemini 키 발급, 로컬 모델 연결 중 하나를
안내합니다. `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DASHSCOPE_API_KEY`, `DEEPSEEK_API_KEY` 중 하나가 이미
설정되어 있으면 묻지 않고 그 프로바이더의 기본 모델로 시작합니다. 나중에 프로바이더를 바꾸려면
`__PRODUCT_CLI_NAME__ --configure`를 실행하세요.

아직 신뢰하지 않은 Git 저장소에서는 프로젝트의 지침 파일, 설정, 스킬, 훅을 불러오기 전에 이 워크스페이스를
신뢰할지 묻습니다. 거절하면 이것들 없이 Restricted 상태로 세션을 시작합니다.

**한 줄로 워크플로우 작성하기.** 설정을 마친 뒤에는 여러 단계로 된 작업을 자연어로 설명하면 CLI가 워크플로우를
만들어 바로 실행합니다:

```bash
__PRODUCT_CLI_NAME__
> /workflows create "CLI 도구의 태그라인을 세 개 쓰고, 가장 좋은 것을 골라 이유를 설명해줘"
```

`/workflows create`는 활성 프로바이더에게 워크플로우 설계를 요청하고, 이를 `.workflows/<name>.json`에 저장한
다음 즉시 실행합니다. 자세한 내용은 [CLI Reference](../../guide/cli.md#workflows-workflows)(영어)를
참고하세요.

### 지원 프로바이더

| 프로바이더                          | 기본 모델과 예시                              | 키 변수             | 키 발급                                                                        |
| ----------------------------------- | --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| Anthropic (Claude)                  | `claude-sonnet-4-6` (기본), `claude-opus-4-6` | `ANTHROPIC_API_KEY` | [platform.claude.com](https://platform.claude.com/settings/keys)               |
| OpenAI                              | 설정할 때 모델을 입력 (예: `gpt-5.1`)         | `OPENAI_API_KEY`    | [platform.openai.com](https://platform.openai.com/api-keys)                    |
| Gemini                              | `gemini-3-flash-preview` (기본)               | `GEMINI_API_KEY`    | [aistudio.google.com](https://aistudio.google.com/apikey)                      |
| DeepSeek                            | `deepseek-v4-flash` (기본), `deepseek-v4-pro` | `DEEPSEEK_API_KEY`  | [platform.deepseek.com](https://platform.deepseek.com/api_keys)                |
| Qwen (Alibaba Cloud)                | `qwen-plus` (기본), `qwen-max`                | `DASHSCOPE_API_KEY` | [Model Studio](https://modelstudio.console.alibabacloud.com/?tab=api#/api-key) |
| 로컬 (Ollama, LM Studio, llama.cpp) | 서버에서 실행 중인 모델                       | —                   | 키 불필요                                                                      |

## 첫 번째 에이전트

### 1. 간단한 대화형 에이전트 만들기

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new ConversationAgent({
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

### 2. 에이전트가 사용할 도구 추가하기

`createZodFunctionTool`은 함수를 실행하기 전에 모델이 넘긴 인자를 Zod 스키마로 검증하고, 그 스키마로 함수
입력의 타입을 정합니다.

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
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
  async ({ city }) => ({ city, temperature: 22, condition: 'sunny' }),
);

const agent = new ConversationAgent({
  name: 'WeatherBot',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You help users check the weather.',
  tools: [weatherTool],
});

// 필요할 때 에이전트가 get_weather를 호출합니다
const response = await agent.run('서울 날씨가 어때?');
console.log(response);
```

### 3. 프로바이더 동적 전환

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new ConversationAgent({
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

// 대화 도중 OpenAI로 전환 — 대화 기록은 그대로 이어집니다
agent.setModel({ provider: 'openai', model: 'gpt-5.1' });
response = await agent.run('대화를 이어가 주세요.');
```

### 4. 내장 도구가 있는 세션 사용하기

`@robota-sdk/agent-framework`의 `InteractiveSession`은 CLI가 쓰는 바로 그 세션입니다. 내장 도구(파일 읽기·
쓰기·편집, glob·grep 검색, 셸, 웹 가져오기·검색), 권한 모드, 훅, 컴팩션, 스트리밍 이벤트를 갖춘 대화를
제공합니다.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
  model: 'claude-sonnet-4-6',
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));

// submit()은 프롬프트가 접수되면 끝나고, `completed`는 턴이 끝나면 완료됩니다.
const turn = await session.submit('src/의 TypeScript 파일을 나열하고 각 파일이 하는 일을 알려줘.');
const { response } = await turn.completed;
```

도구는 `cwd` 안에서 동작합니다. `default` 모드에서는 읽기와 검색이 바로 실행되고, 편집이나 셸 명령은
`permission_request` 이벤트로 승인을 요청하며, 이 이벤트를 듣는 리스너가 없으면 거부됩니다. 세션은 다음
`submit()`을 위해 대화를 유지합니다. `projectAccess` 결정이 없으면 Restricted로 실행되어 `AGENTS.md`,
`CLAUDE.md`, 프로젝트 설정을 읽지 않습니다. 이것들을 불러오려면 신뢰된 `projectAccess`를 넘기세요 —
[Project context and settings](../../guide/sdk.md#project-context-and-settings)(영어) 참고.
`model`을 생략하면 세션은 프로바이더에 `claude-opus-4-5`를 요청합니다.

### 5. CLI 사용

```bash
# 인터랙티브 TUI
__PRODUCT_CLI_NAME__

# 원샷(print 모드. Git 저장소에서는 먼저 `__PRODUCT_CLI_NAME__ trust --yes`로 신뢰하세요)
__PRODUCT_CLI_NAME__ -p "이 프로젝트의 모든 TODO 주석을 나열해줘"

# 모델 오버라이드
__PRODUCT_CLI_NAME__ --model claude-opus-4-6
```

## 다음 단계

> 아래 문서는 아직 한국어 번역이 없어 영어 문서로 연결됩니다.

- [5-Minute Quick Start](../../quickstart.md) — `createQuery()`로 SDK 사용, 다른 프로바이더, AI 게이트웨이
- [Building Agents](../../guide/building-agents.md) — agent-core 에이전트 패턴
- [Using the SDK](../../guide/sdk.md) — `InteractiveSession`, `createQuery()`, 세션, 트랜스포트
- [CLI Reference](../../guide/cli.md) — 전체 CLI 사용법.
  [`/workflows create`](../../guide/cli.md#workflows-workflows) 자연어 워크플로우 작성 포함
- [Architecture](../../guide/architecture.md) — 패키지 계층과 설계
- [Providers Reference](../../guide/providers.md) — 전체 프로바이더, 옵션, 모델 이름
- [Error Handling](../../guide/error-handling.md) — 에러 타입, 재시도 패턴, 모범 사례
- [Migration Guide](../../guide/migration.md) — v2.x → 3.0.0 업그레이드
- [Examples](../../examples/README.md) — 작업별 예제

## 문제 해결

**macOS Terminal.app + 한글/CJK 입력**: IME 조합 중 macOS Terminal.app이 크래시될 수 있습니다.
**[iTerm2](https://iterm2.com/)** 같은 다른 터미널을 쓰거나 print 모드(`__PRODUCT_CLI_NAME__ -p`)를 사용하세요. CLI는
Terminal.app에서 시작하면 경고를 표시합니다.

**Node.js 버전**: Robota는 Node.js 22.12 이상이 필요합니다. `node --version`으로 확인하세요.
[Volta](https://volta.sh/)나 [nvm](https://github.com/nvm-sh/nvm)으로 버전을 관리할 수 있습니다.

**API 키를 찾을 수 없음**: 환경 변수로 키를 설정(`export ANTHROPIC_API_KEY=...`)하거나
`__PRODUCT_CLI_NAME__ --configure`를 실행해 안내를 따르세요.

**"Workspace trust is required before headless startup"**: print 모드(`__PRODUCT_CLI_NAME__ -p`)는 신뢰하지 않은 Git
저장소에서 시작하지 않습니다. 그 저장소에서 `__PRODUCT_CLI_NAME__ trust --yes`를 실행하거나, `--safe-mode`를 붙여 모든
사용자 정의(지침 파일, 스킬, 플러그인, 훅, MCP 서버)를 끈 채로 실행하세요.
