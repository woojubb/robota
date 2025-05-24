# @robota-sdk/mcp

Robota SDK를 위한 Model Context Protocol(MCP) 통합 패키지입니다.

## 문서

전체 문서는 [https://robota.io](https://robota.io)를 참조하세요.

## 설치

```bash
npm install @robota-sdk/mcp @robota-sdk/core @modelcontextprotocol/sdk
```

## 개요

`@robota-sdk/mcp`는 Robota SDK를 위한 Model Context Protocol(MCP) 통합을 제공합니다. 이 패키지를 통해 Robota 프레임워크 내에서 MCP 호환 AI 모델 제공자를 사용할 수 있습니다.

## MCP란 무엇인가요?

Model Context Protocol(MCP)은 다양한 AI 모델과 상호 작용하기 위한 표준화된 인터페이스입니다. MCP 인터페이스를 구현함으로써 Robota는 이 프로토콜을 지원하는 모든 제공자와 원활하게 작동할 수 있습니다.

## 기본 사용법

```typescript
import { Robota } from '@robota-sdk/core';
import { MCPProvider } from '@robota-sdk/mcp';
import { createMCPClient } from '@modelcontextprotocol/sdk';

// MCP 클라이언트 생성
const mcpClient = createMCPClient({
  // MCP 호환 모델 제공자를 위한 구성
  apiKey: process.env.MCP_API_KEY,
  baseUrl: 'https://your-mcp-provider.com/api'
});

// MCP 제공자 생성
const provider = new MCPProvider({
  model: 'your-model-name',
  client: mcpClient
});

// MCP 제공자로 Robota 인스턴스 생성
const robota = new Robota({
  provider,
  systemPrompt: '당신은 도움이 되는 AI 비서입니다.'
});

// 간단한 대화 실행
const response = await robota.run('표준화된 프로토콜을 사용하는 이점은 무엇인가요?');
console.log(response);
```

## 함수 호출

MCP 제공자는 기본 모델에서 사용 가능한 경우 함수 호출 기능을 지원합니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { MCPProvider } from '@robota-sdk/mcp';
import { createMCPClient } from '@modelcontextprotocol/sdk';
import { z } from 'zod';

// 도구와 함께 제공자 초기화
const provider = new MCPProvider({
  model: 'your-model-name',
  client: createMCPClient({ /* 설정 */ }),
  tools: [
    {
      name: 'searchDatabase',
      description: '정보를 검색하기 위해 데이터베이스 검색',
      parameters: z.object({
        query: z.string().describe('검색 쿼리'),
        limit: z.number().optional().describe('최대 결과 수')
      }),
      execute: async (params) => {
        // 데이터베이스 검색 로직 구현
        return { results: ['결과 1', '결과 2'] };
      }
    }
  ]
});

const robota = new Robota({ provider });
const response = await robota.run('신경망에 대한 정보를 검색해주세요');
```

## 이점

- **상호 운용성**: Robota에서 MCP 호환 모델 사용 가능
- **표준화**: 다양한 모델 제공자 간의 일관된 인터페이스
- **미래 대비**: 새로운 모델 제공자가 출시되면 쉽게 통합 가능

## 라이선스

MIT 