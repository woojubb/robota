# @robota-sdk/agent-sdk SPEC

## Overview

Robota SDK는 기존 Robota 패키지들을 **조립**하여 만든 프로그래밍 SDK입니다.
독자적인 재구현이 아니라, 기존 패키지를 연결하고 통합하는 레이어입니다.

## 핵심 원칙

1. **조립 우선**: 모든 기능은 기존 패키지를 사용하여 구현. 독자 구현 금지.
2. **이중화 금지**: 기존 패키지에 동일 기능이 있으면 그것을 사용. 필요시 기존 패키지를 리팩토링.
3. **연결 필수**: agent-sdk의 모든 기능은 Robota 패키지 생태계와 연결되어야 함.

## 패키지 조립 구조

```
@robota-sdk/agent-sdk (조립 레이어)
├── agent-core          ← Robota 엔진, 실행 루프, 대화 관리
├── agent-sessions      ← 세션/챗 관리, 멀티세션, 템플릿
├── agent-tools         ← tool 생성 인프라 (FunctionTool, Zod)
├── agent-tool-mcp      ← MCP 서버 통합
├── agent-team          ← 멀티에이전트 위임, sub-agent
├── agent-event-service ← 이벤트 시스템, 관찰 가능성
├── agent-provider-*    ← AI provider (Anthropic, OpenAI, Google 등)
└── agent-plugin-*      ← 플러그인 (로깅, 분석, 에러핸들링 등)
```

## 기능별 패키지 매핑

### Session 관리

- **사용**: `agent-sessions` (SessionManager, ChatInstance)
- **금지**: 독자적 Session 클래스 재구현
- **역할**: agent-sdk는 agent-sessions의 SessionManager를 설정하고 초기화하는 팩토리를 제공
- **리팩토링**: agent-sessions에 부족한 기능(permission, hooks, streaming)을 추가

### Persistence

- **사용**: `agent-sessions`의 persistence 인터페이스
- **역할**: agent-sdk는 파일 기반 persistence 어댑터를 구현하여 agent-sessions에 주입
- **리팩토링**: agent-sessions의 no-op persistence를 실제 구현으로 교체

### Tool 시스템

- **사용**: `agent-tools` (createZodFunctionTool, FunctionTool)
- **역할**: agent-sdk는 built-in tool 구현체(Bash, Read 등)를 제공하되, agent-tools의 인프라 위에 구축
- **현재 상태**: 이미 올바르게 사용 중 ✓

### MCP 통합

- **사용**: `agent-tool-mcp` (MCPTool, RelayMcpTool)
- **역할**: agent-sdk의 query() 옵션에서 MCP 서버를 설정하면 agent-tool-mcp를 통해 연결
- **현재 상태**: 미연결 → 연결 필요

### Sub-agent / 멀티에이전트

- **사용**: `agent-team` (createAssignTaskRelayTool, 템플릿 레지스트리)
- **금지**: 독자적 agentTool 구현
- **역할**: agent-sdk의 Agent tool은 agent-team의 위임 패턴을 사용
- **현재 상태**: 독자 구현됨 → agent-team 사용으로 교체

### 이벤트 시스템

- **사용**: `agent-event-service` (IEventService, StructuredEventService)
- **역할**: Session 생명주기 이벤트 (시작, 종료, tool 호출, 에러)를 agent-event-service로 발행
- **현재 상태**: 미연결 → 연결 필요

### AI Provider

- **사용**: `agent-provider-anthropic` (기본), 다른 provider도 설정 가능
- **현재 상태**: 이미 사용 중 ✓ (다만 Anthropic 하드코딩됨 → 설정 가능하게 변경)

### 플러그인

- **사용**: `agent-plugin-*` (logging, analytics, error-handling 등)
- **역할**: agent-sdk 생성 시 플러그인 목록을 설정하여 Robota에 주입
- **현재 상태**: 미연결 → 연결 필요

## query() API

```typescript
import { query } from '@robota-sdk/agent-sdk';

// 기본 사용
const response = await query('파일 목록을 보여줘');

// 전체 옵션
const response = await query('코드를 분석해줘', {
  cwd: '/path/to/project',
  provider: 'anthropic',           // agent-provider-* 선택
  model: 'claude-sonnet-4-6',
  permissionMode: 'acceptEdits',
  plugins: ['logging', 'analytics'], // agent-plugin-* 활성화
  mcpServers: { ... },              // agent-tool-mcp 연결
  hooks: { ... },
  onTextDelta: (delta) => {},       // streaming
  sessionId: 'resume-session',     // agent-sessions 세션 재개
});
```

## 리팩토링 우선순위

1. **Session**: agent-sessions의 ChatInstance를 기반으로 재구성
2. **Persistence**: agent-sessions에 실제 persistence 구현 주입
3. **Events**: agent-event-service 연결
4. **Sub-agent**: agent-team 사용으로 교체
5. **MCP**: agent-tool-mcp 연결
6. **Plugins**: agent-plugin-\* 설정 지원
7. **Provider**: 다중 provider 설정 지원

## 의존성 방향

```
agent-sdk
  ├── agent-core (엔진)
  ├── agent-sessions (세션 관리)
  ├── agent-tools (tool 인프라)
  ├── agent-tool-mcp (MCP)
  ├── agent-team (멀티에이전트)
  ├── agent-event-service (이벤트)
  ├── agent-provider-anthropic (기본 provider)
  └── agent-plugin-* (선택적 플러그인)
```

역방향 의존 금지: 위 패키지들은 agent-sdk에 의존하지 않음.
