# MCP (Model Context Protocol) 예제

이 디렉토리에는 `@modelcontextprotocol/sdk` 라이브러리를 사용하여 MCP를 구현하는 예제가 포함되어 있습니다.

## 파일 구조

- `mcp-demo.ts` - STDIO 트랜스포트를 사용한 MCP 서버
- `mcp-client-example.ts` - STDIO 클라이언트 예제
- `mcp-agent-example.ts` - MCP 클라이언트와 Robota 에이전트 통합 예제

## 예제 실행 방법

### 기본 MCP 예제

1. MCP 서버 실행:
```bash
bun run apps/examples/mcp/mcp-demo.ts
```

2. 클라이언트 실행:
```bash
bun run apps/examples/mcp/mcp-client-example.ts
```

### Robota 에이전트 통합 예제

```bash
bun run apps/examples/mcp/mcp-agent-example.ts
```

## 예제 설명

### MCP 서버 (mcp-demo.ts)
- StdioServerTransport를 사용하여 표준 입출력을 통해 MCP 서버를 노출
- 'add' 도구와 'getWeather' 도구 구현
- 'greeting' 리소스 제공

### MCP 클라이언트 예제 (mcp-client-example.ts)
- StdioClientTransport를 사용하여 MCP 서버 프로세스 시작 및 연결
- `run` 메서드를 통해 함수 호출 실행
- 덧셈 및 날씨 정보 조회 기능 테스트

### Robota 에이전트 통합 예제 (mcp-agent-example.ts)
- MCP 클라이언트를 Robota 에이전트와 통합
- MCPProvider 클래스를 통한 통합 구현
- 날씨 및 덧셈 함수 호출 예제

## 구현 방법

1. MCP 서버 생성: McpServer 클래스를 사용하여 MCP 서버 인스턴스 생성
2. 도구 및 리소스 등록: tool() 및 resource() 메서드를 사용하여 기능 추가
3. 트랜스포트 설정: StdioServerTransport 사용
4. 서버 연결: connect() 메서드로 트랜스포트 연결
5. 클라이언트 생성: Client 클래스와 적절한 트랜스포트 사용
6. 요청 보내기: run() 메서드로 요청 전송
7. Robota 에이전트와 통합: MCPProvider를 통한 통합

## 실행 요구사항

- Node.js 16 이상
- Bun 런타임
- @modelcontextprotocol/sdk 라이브러리 설치

## 참고 사항

- 실제 구현에서는 클라이언트 인증 및 오류 처리 로직 추가 필요
- 프로덕션 환경에서는 보안 고려사항 및 로깅 추가 필요
- 이 예제는 데모용으로, 실제 구현에서는 더 체계적인 에러 핸들링과 타입 정의 필요 