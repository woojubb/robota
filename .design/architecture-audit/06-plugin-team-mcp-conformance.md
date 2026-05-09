# Plugin/Team/MCP SPEC.md 정합성 보고서

## 검수 날짜: 2026-05-09

## ARCH-CONF-005: agent-plugin-\* (9개)

### 의존성 검증 결과

모든 9개 패키지의 의존성 구조:

- `dependencies`: 없음 (agent-plugin-webhook만 `jssha` 포함, 외부 라이브러리이므로 허용)
- `peerDependencies`: `@robota-sdk/agent-core` 단독
- `devDependencies`: `@robota-sdk/agent-core`, 빌드 도구만 포함

→ agent-sdk, agent-sessions, agent-cli 의존 없음. 전체 9개 패키지 **의존성 준수**.

### SPEC.md 검증 결과 및 조치

| 패키지                            | 의존성 상태 | SPEC.md 상태 (검수 전) | 조치                            |
| --------------------------------- | ----------- | ---------------------- | ------------------------------- |
| agent-plugin-conversation-history | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-error-handling       | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-event-emitter        | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-execution-analytics  | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-limits               | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-logging              | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-performance          | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-usage                | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |
| agent-plugin-webhook              | ✅ 준수     | ⚠️ 추가 필요           | Boundaries 섹션에 2개 항목 추가 |

### 추가된 내용 (전 패키지 동일)

```
- Implements `AbstractPlugin` from `@robota-sdk/agent-core`. This package depends only on
  `agent-core` and must not import `agent-sdk`, `agent-sessions`, `agent-cli`, or any other
  agent-* package.
- Injected by the consuming layer (agent-cli or composition root) at construction time.
  This package does not own a registry or factory; the consumer selects and wires plugins.
```

---

## ARCH-CONF-008: agent-team, agent-tool-mcp

### 의존성 검증 결과

**agent-team**

- `dependencies`: `uuid`, `zod`, `@robota-sdk/agent-core`, `@robota-sdk/agent-tools`, `@robota-sdk/agent-tool-mcp`, `@robota-sdk/agent-event-service`
- `peerDependencies`: 없음
- agent-sdk, agent-sessions, agent-cli 의존 없음 → **의존성 준수**

**agent-tool-mcp**

- `dependencies`: 없음
- `peerDependencies`: `@robota-sdk/agent-core`, `@robota-sdk/agent-tools`, `@modelcontextprotocol/sdk`
- agent-sdk, agent-sessions, agent-cli 의존 없음 → **의존성 준수**

### SPEC.md 검증 결과 및 조치

| 패키지         | 의존성 상태 | SPEC.md 상태 (검수 전)          | 조치                                                              |
| -------------- | ----------- | ------------------------------- | ----------------------------------------------------------------- |
| agent-team     | ✅ 준수     | ⚠️ 금지 의존성 명시 누락        | Boundaries 섹션에 허용/금지 의존성 및 주입 패턴 항목 추가         |
| agent-tool-mcp | ✅ 준수     | ⚠️ 추가 필요 (최소 템플릿 상태) | Boundaries 섹션에 MCP 역할, 허용/금지 의존성, 주입 패턴 항목 추가 |

### agent-team에 추가된 내용

```
- Implements relay tool behavior (delegating work to child agents) using the tool contract from
  `@robota-sdk/agent-tools` and MCP relay support from `@robota-sdk/agent-tool-mcp`. Allowed
  dependencies: `@robota-sdk/agent-core`, `@robota-sdk/agent-tools`, `@robota-sdk/agent-tool-mcp`,
  and `@robota-sdk/agent-event-service`. Must not import `agent-sdk`, `agent-sessions`,
  `agent-cli`, or any other agent-* package outside this list.
- Injected by the consuming layer (agent-cli or composition root) at construction time.
  This package does not own a global agent registry; the consumer provides AI providers and
  event service at wiring time.
```

### agent-tool-mcp에 추가된 내용

```
- Implements the tool contract defined in `@robota-sdk/agent-tools` using the MCP (Model Context
  Protocol) transport. Allowed dependencies: `@robota-sdk/agent-core`, `@robota-sdk/agent-tools`,
  and `@modelcontextprotocol/sdk`. Must not import `agent-sdk`, `agent-sessions`, `agent-cli`, or
  any other agent-* package.
- Injected by the consuming layer (agent-cli or composition root) at construction time.
  This package does not own a registry or factory; the consumer selects and wires tools.
```

---

## 완료 처리 결과

| 백로그 항목   | 대상 패키지 수 | 의존성 위반 | SPEC 업데이트 | 상태 |
| ------------- | -------------- | ----------- | ------------- | ---- |
| ARCH-CONF-005 | 9              | 0건         | 9건 (전체)    | 완료 |
| ARCH-CONF-008 | 2              | 0건         | 2건 (전체)    | 완료 |

- 모든 11개 패키지의 실제 의존성은 아키텍처 레이어 규칙을 준수하고 있었음.
- SPEC.md가 최소 템플릿 수준으로만 작성되어 있어 아키텍처 규칙이 문서에 반영되지 않은 상태였음.
- 각 패키지 SPEC.md의 Boundaries 섹션에 허용/금지 의존성과 소비자 주입 패턴을 명시하여 정합성 확보 완료.
