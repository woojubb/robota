# Claude Code CLI vs Claude Agent SDK 비교 분석

## 핵심 관계

- **Claude Agent SDK**는 Claude Code의 런타임을 추출한 프로그래밍 라이브러리
- Claude Code CLI는 Agent SDK 위에 구축된 하나의 인터페이스
- SDK로 "커스텀 Claude Code"를 만들 수 있음 — 동일한 도구, 권한, 훅, 컨텍스트를 코드로 제어

## 아키텍처

```
Claude Agent SDK (런타임 엔진)
├── Claude Code CLI (인터랙티브 터미널 인터페이스)
└── 커스텀 에이전트 (SDK로 구축한 프로그래밍 에이전트)
```

SDK는 내부적으로 Claude Code CLI를 subprocess로 실행하여 도구를 실행함.

## Feature 비교

| Feature                      | Claude Code CLI | Agent SDK                     | 비고           |
| ---------------------------- | --------------- | ----------------------------- | -------------- |
| 인터랙티브 REPL              | ✅              | ❌                            | CLI 전용       |
| File tools (Read/Write/Edit) | ✅              | ✅                            | 동일           |
| Shell (Bash)                 | ✅              | ✅                            | 동일           |
| Web tools (Search/Fetch)     | ✅              | ✅                            | 동일           |
| MCP 서버                     | ✅              | ✅                            | 동일 설정      |
| 커스텀 도구                  | MCP만           | MCP + `createSdkMcpServer`    | SDK가 더 유연  |
| Hooks                        | shell 스크립트  | async 함수                    | 다른 구현      |
| Permissions                  | settings.json   | 옵션 객체                     | 같은 규칙 문법 |
| Skills                       | 자동 발견       | `settingSources` opt-in       |                |
| Sub-agents                   | ✅              | ✅                            |                |
| Sessions                     | ✅              | ✅                            |                |
| CLAUDE.md 로딩               | 자동            | `settingSources: ["project"]` | SDK는 opt-in   |
| Streaming                    | ✅              | ✅                            |                |
| Permission modes             | ✅              | ✅ + `dontAsk` 추가           |                |

## SDK 주요 API

### query() — 핵심 함수

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: 'Find and fix the bug in auth.py',
  options: {
    cwd: '/path/to/project',
    allowedTools: ['Read', 'Edit', 'Bash'],
    disallowedTools: ['DeleteFile'],
    permissionMode: 'acceptEdits',
    maxTurns: 10,
    model: 'claude-3-5-sonnet-20241022',
    systemPrompt: 'You are a senior developer',
    settingSources: ['project', 'user'],

    // 훅 — async 함수로 정의
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [validateCommand] }],
      PostToolUse: [{ matcher: 'Edit', hooks: [auditFileChange] }],
    },

    // MCP 서버
    mcpServers: {
      playwright: { command: 'npx', args: ['@playwright/mcp'] },
      custom: customServerInstance,
    },

    // Sub-agents
    agents: {
      'code-reviewer': {
        description: 'Reviews code for quality',
        tools: ['Read', 'Glob', 'Grep'],
      },
    },

    // 세션 재개
    resume: sessionId,
  },
})) {
  console.log(message);
}
```

### 커스텀 도구 (SDK 전용)

```typescript
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const customServer = createSdkMcpServer({
  name: 'my-tools',
  tools: [
    tool('get_weather', 'Get weather', { lat: z.number(), lon: z.number() }, async (args) => ({
      content: [{ type: 'text', text: 'Sunny' }],
    })),
  ],
});
```

### 훅 비교

**CLI (settings.json — shell 스크립트)**:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "./validate.sh" }]
      }
    ]
  }
}
```

**SDK (async 함수)**:

```typescript
const validateCommand = async (input, toolUseId, { signal }) => {
  if (input.tool_input.command.includes('rm -rf')) {
    return { hookSpecificOutput: { permissionDecision: 'deny', reason: 'Blocked' } };
  }
  return {};
};
```

## Permission Modes

| Mode                | 동작                | CLI | SDK |
| ------------------- | ------------------- | --- | --- |
| `default`           | 모든 도구 승인 필요 | ✅  | ✅  |
| `acceptEdits`       | 파일 수정 자동 승인 | ✅  | ✅  |
| `bypassPermissions` | 모든 도구 자동 승인 | ✅  | ✅  |
| `plan`              | 읽기만 가능         | ✅  | ✅  |
| `dontAsk`           | 허용 목록 외 거부   | ❌  | ✅  |

평가 순서 (동일): Hooks → Deny rules → Permission mode → Allow rules → canUseTool 콜백

## 컨텍스트 로딩

| 소스                    | CLI       | SDK                                                       |
| ----------------------- | --------- | --------------------------------------------------------- |
| CLAUDE.md               | 자동      | `settingSources: ["project"]`                             |
| .claude/skills/         | 자동 발견 | `settingSources: ["project"]` + `allowedTools: ["Skill"]` |
| .claude/settings.json   | 자동      | `settingSources: ["project"]`                             |
| ~/.claude/settings.json | 자동      | `settingSources: ["user"]`                                |

## 세션 관리

```typescript
// 첫 번째 쿼리
let sessionId: string;
for await (const msg of query({ prompt: 'Analyze the code' })) {
  if (msg.session_id) sessionId = msg.session_id;
}

// 컨텍스트 유지하며 이어서
for await (const msg of query({ prompt: 'Now refactor it', options: { resume: sessionId } })) {
  console.log(msg);
}
```

## CLI 전용 기능

- 인터랙티브 REPL
- IDE 통합 (VS Code, JetBrains)
- 설정 UI
- 플러그인 마켓플레이스
- GUI 권한 승인
- 슬래시 커맨드 (.claude/commands/)
- 설정 변경 자동 리로드

## SDK에서 구축 가능한 것

- 모든 핵심 에이전트 기능 ✅
- 모든 도구 ✅
- 모든 훅 ✅
- 모든 권한 ✅
- 세션 ✅
- Skills ✅
- MCP 서버 ✅
- Sub-agents ✅

## Robota 매핑

| Claude                           | Robota 현재                      | 필요한 변화             |
| -------------------------------- | -------------------------------- | ----------------------- |
| Claude Code CLI                  | `@robota-sdk/agent-cli`          | TUI 개선 필요           |
| Claude Agent SDK `query()`       | 없음                             | **새로 만들어야 함**    |
| `@anthropic-ai/claude-agent-sdk` | `@robota-sdk/agent-core` + tools | SDK surface 정리 필요   |
| `createSdkMcpServer`             | 없음                             | MCP 통합 필요           |
| `settingSources`                 | context-loader                   | 이미 구현됨             |
| Hooks (async)                    | hook-runner (shell)              | async 함수 훅 추가 필요 |

### 핵심 gap: `query()` 함수

Claude Agent SDK의 `query()`에 해당하는 단일 진입점이 Robota에 없음. 현재 Session 클래스가 이 역할을 하지만:

- CLI 내부에 갇혀 있음 (별도 패키지가 아님)
- 프로그래밍 API로 설계되지 않음
- 도구, 훅, 컨텍스트 로딩이 하드코딩됨

**제안**: `@robota-sdk/agent` 패키지를 만들어 `query()` 함수를 제공하고, agent-cli는 이를 사용하는 얇은 TUI 레이어로 변경.
