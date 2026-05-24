---
title: 'PM-037: README에 "왜 Robota인가?" 섹션 + SDK 임베딩 예제 추가'
status: todo
created: 2026-05-24
priority: high
category: marketing
---

## 문제

README가 "어떻게 쓰는가"에만 집중하고 "왜 이것을 써야 하는가"가 없다.

**가장 큰 차별점인 SDK 임베딩이 README 하단에 묻혀 있고 코드 예제도 없다:**

- `@robota-sdk/agent-framework`를 임베딩하는 방법이 README에 없음
- 이 기능의 경쟁자(Claude Code, Aider, Cline)가 없음에도 활용 안 됨

**"왜 Robota인가?" 섹션도 없다:**

- 경쟁사 대비 포지셔닝이 명시되지 않음
- 개발자가 선택 근거를 찾을 수 없음

## 해결 방법

README 상단에 2개 섹션 추가:

### 섹션 1: Why Robota?

```markdown
## Why Robota?

|                                              | Robota | Claude Code | Aider |
| -------------------------------------------- | ------ | ----------- | ----- |
| Multi-provider (OpenAI, Gemini, DeepSeek...) | ✅     | ❌          | ✅    |
| Embed in your own app (SDK)                  | ✅     | ❌          | ❌    |
| Local models (LM Studio, Ollama)             | ✅     | ❌          | ✅    |
| Open source (MIT)                            | ✅     | partial     | ✅    |
| Claude Code config compatible                | ✅     | —           | ❌    |
```

### 섹션 2: Embed in Your App (5줄 예제)

```typescript
import { createAgentRuntime, InteractiveSession } from '@robota-sdk/agent-framework';
import { createAnthropicProvider } from '@robota-sdk/agent-provider';

const runtime = createAgentRuntime({ provider: createAnthropicProvider({ apiKey }) });
const session = runtime.createSession({ permissionMode: 'bypassPermissions' });
const response = await session.submit('Explain this codebase');
```

## 수용 기준

- [ ] README 상단에 "Why Robota?" 비교 표 추가
- [ ] SDK 임베딩 최소 예제 코드 스니펫 추가
- [ ] 동작하는 예제인지 타입체크로 확인
- [ ] SDK Starter Kit(PM-029)과 연결

## 관련 파일

- `packages/agent-cli/README.md`
