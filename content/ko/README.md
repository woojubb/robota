---
layout: home
title: Robota
description: An adaptable foundation for AI agents, delivered through composable TypeScript libraries and maintained agent interfaces.
lang: ko-KR
---

# Robota

**Our agents develop and advance our agents.** Our direction is a dependable, adaptable foundation
on which agents can carry their own development forward. The [canonical vision](__PROJECT_REPOSITORY_URL__/blob/develop/VISION.md)
states the ambition; autonomous self-evolution is not a current guarantee.

Today, composable TypeScript libraries provide strict types, one provider interface across model
vendors, runtime-validated tool arguments, plugins and events. Install only the packages your agent
needs, or use `__PRODUCT_CLI_NAME__` (`@robota-sdk/agent-cli`), the coding-capable terminal interface
built from the same libraries.

[![npm version](https://img.shields.io/npm/v/@robota-sdk/agent-core?label=npm)](https://www.npmjs.com/package/@robota-sdk/agent-core)
[![npm downloads](https://img.shields.io/npm/dm/@robota-sdk/agent-cli?label=downloads)](https://www.npmjs.com/package/@robota-sdk/agent-cli)
[Source repository](__PROJECT_REPOSITORY_URL__)
[![License: AGPL-3.0 OR Commercial](https://img.shields.io/badge/license-AGPL--3.0%20OR%20Commercial-blue)](../../LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

> **베타** — 패키지는 `3.0.0-beta` 버전으로 배포됩니다. 정식 릴리스 전에 API가 바뀔 수 있습니다.
> [이슈 보고](__PROJECT_REPOSITORY_URL__/issues).

## 어디서 시작할까요

- [시작하기](./getting-started/README.md) — 설치, 프로바이더 선택, 첫 에이전트까지 단계별 안내

> 아래 문서는 아직 한국어 번역이 없어 영어 문서로 연결됩니다.

- [5-Minute Quick Start](../quickstart.md) — 에이전트나 CLI를 가장 빨리 실행하는 방법
- [Guide](../guide/README.md) — 아키텍처, SDK, CLI, 프로바이더, 권한, 세션
- [Examples](../examples/README.md) — 작업 하나씩 다루는 예제
- [Packages](/packages/) — 모든 패키지와 각 패키지의 역할, npm 배포 여부
- [Plugin Directory](../plugins/README.md) — 라이프사이클 플러그인과 직접 만든 플러그인을 등록하는 방법
- [Running Robota in GitHub Actions](../integrations/github-action.md)
- [Changelog](../changelog/README.md) — 지난 릴리스의 주요 변경 사항
- [Development](../development/README.md) — 이 모노레포에서 작업하기

## 설치

배포된 패키지는 Node.js 22.12 이상이 필요합니다.

```bash
# 에이전트: 코어 엔진과 프로바이더 패키지 하나
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic

# Zod 스키마를 쓰는 함수 도구 (agent-tools는 Zod 3를 사용)
npm install @robota-sdk/agent-tools zod@3

# 내장 도구, 권한 모드, 훅, 프로젝트 컨텍스트를 갖춘 세션
npm install @robota-sdk/agent-framework @robota-sdk/agent-provider-anthropic

# The CLI
npm install -g @robota-sdk/agent-cli
```

## 첫 번째 에이전트

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const agent = new ConversationAgent({
  name: 'Assistant',
  aiProviders: [new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY })],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  systemMessage: 'You are a helpful assistant.',
});

console.log(await agent.run('TypeScript 제네릭을 두 문장으로 설명해줘.'));
```

`aiProviders`에는 프로바이더를 여러 개 넣을 수 있고, `agent.setModel({ provider, model })`로 대화를 유지한 채
전환합니다. 도구, 프로바이더 전환, 세션은 [시작하기](./getting-started/README.md)에서 이어집니다.

## 패키지 구성

패키지는 세 계층으로 나뉩니다. 어느 계층에서든 시작할 수 있습니다.

- **라이브러리** — [`agent-core`](../../packages/agent-core/docs/README.md)(`Robota` 엔진과 프로바이더·도구·
  플러그인·권한 계약), 모델 벤더마다 하나씩인 `agent-provider-<vendor>` 패키지,
  [`agent-tools`](../../packages/agent-tools/docs/README.md)(함수 도구와 내장 도구 팩토리),
  [`agent-plugin`](../../packages/agent-plugin/docs/README.md)(라이프사이클 플러그인),
  [`agent-mcp`](../../packages/agent-mcp/docs/README.md)(MCP 클라이언트).
- **조립** — [`agent-framework`](../../packages/agent-framework/docs/README.md)가 라이브러리를 세션으로
  묶습니다: `InteractiveSession`, `createQuery()`, `createAgentRuntime()`, 그리고 내장 도구, 권한 모드, 훅,
  컨텍스트 로딩, 영속성.
- **Agent interface** — [`agent-cli`](../../packages/agent-cli/docs/README.md), the `__PRODUCT_CLI_NAME__` terminal coding
  assistant, built on the assembly layer with a terminal UI, slash commands and transports.

계층 전체는 [architecture guide](../guide/architecture.md)(영어)와
[ARCHITECTURE.md](../../ARCHITECTURE.md)(영어)에서 설명합니다. 모든 패키지는
[packages index](/packages/)에 있습니다.

## 프로바이더

| 패키지                                         | 범위                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-provider-anthropic`         | Anthropic Claude                                                                                              |
| `@robota-sdk/agent-provider-openai`            | OpenAI, 그리고 `baseURL`로 연결하는 모든 OpenAI 호환 엔드포인트(AI 게이트웨이, Azure OpenAI, vLLM, 로컬 서버) |
| `@robota-sdk/agent-provider-gemini`            | Google Gemini(이미지 생성 포함)                                                                               |
| `@robota-sdk/agent-provider-openai-compatible` | DeepSeek, Qwen, 그리고 Ollama, LM Studio, llama.cpp 같은 로컬 서버                                            |
| `@robota-sdk/agent-provider-bytedance`         | ByteDance ModelArk 영상 생성(채팅 프로바이더 아님)                                                            |

각 프로바이더는 [Providers Reference](../guide/providers.md)(영어)에서 다룹니다. API 키 없이 로컬 모델을
실행하려면 [Local LLM Setup](../guide/local-llm.md)(영어)을 참고하세요.

## The CLI

```bash
npx @robota-sdk/agent-cli          # 설치 없이 실행
npm install -g @robota-sdk/agent-cli
__PRODUCT_CLI_NAME__                              # 인터랙티브 터미널 UI
__PRODUCT_CLI_NAME__ -p "이 프로젝트를 설명해줘"  # print 모드: 한 번 답하고 종료
```

처음 실행하면 CLI가 프로바이더와 API 키를 묻거나 로컬 모델을 제안합니다. 아직 신뢰하지 않은 Git 저장소에서는
터미널 UI가 프로젝트에서 무엇이든 불러오기 전에 신뢰 여부를 묻고, print 모드는 `__PRODUCT_CLI_NAME__ trust --yes`를 실행할
때까지 시작하지 않습니다. 신뢰된 워크스페이스에서 CLI는 프로젝트의 `AGENTS.md`와 Claude Code 관례를
읽습니다: `CLAUDE.md`, `.claude/settings.json`, `.claude/agents/`, `.claude/skills/`, `.claude/commands/`.
플래그, 슬래시 커맨드, 권한 모드는 [CLI reference](../guide/cli.md)(영어)에서 다룹니다. 다른 코딩
어시스턴트와의 비교: [__PROJECT_WEBSITE_HOST__/ko/compare](__PROJECT_WEBSITE_URL__/ko/compare).

## 라이선스

Robota는 [GNU AGPL-3.0](../../LICENSE) 또는 [상용 라이선스](../../COMMERCIAL.md) 중 하나로 사용할 수 있는
이중 라이선스입니다. [LICENSING.md](../../LICENSING.md)를 참고하세요.
