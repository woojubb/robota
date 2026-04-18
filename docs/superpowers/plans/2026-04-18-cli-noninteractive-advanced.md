# CLI Non-interactive Advanced Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `--bare`, `--allowed-tools`, `--no-session-persistence`, `--json-schema` 4개 플래그를 print mode(`-p`)에 추가한다.

**Architecture:** CLI 플래그 파싱 → `InteractiveSession` 옵션으로 전달 → `createInteractiveSession` 내부에서 bare/allowedTools 처리. `--no-session-persistence`는 CLI에서 `SessionStore`를 생성하지 않는 것으로 구현. `--json-schema`는 `appendSystemPrompt`에 JSON 스키마 지시문을 주입하는 것으로 구현(스키마 검증 라이브러리 없음).

**Tech Stack:** TypeScript, Node.js `parseArgs`, Vitest

---

## File Map

| 파일                                                             | 역할                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-cli/src/utils/cli-args.ts`                       | 4개 플래그 파싱 추가                                                                                                    |
| `packages/agent-cli/src/utils/__tests__/cli-args.test.ts`        | 새 플래그 파싱 테스트                                                                                                   |
| `packages/agent-sdk/src/interactive/interactive-session-init.ts` | `IInteractiveSessionStandardOptions`, `IInitOptions`에 옵션 추가; `createInteractiveSession`에서 bare/allowedTools wire |
| `packages/agent-sdk/src/assembly/create-session.ts`              | `ICreateSessionOptions`에 `allowedTools` 추가; `permissions.allow`에 주입                                               |
| `packages/agent-cli/src/cli.ts`                                  | print mode에서 새 플래그 사용; `--no-session-persistence` 처리                                                          |

---

## Task 1: `cli-args.ts` — 4개 플래그 추가

**Files:**

- Modify: `packages/agent-cli/src/utils/cli-args.ts`
- Modify: `packages/agent-cli/src/utils/__tests__/cli-args.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/agent-cli/src/utils/__tests__/cli-args.test.ts` 파일 끝에 추가:

```ts
describe('new non-interactive flags', () => {
  let originalArgv: string[];
  beforeEach(() => {
    originalArgv = process.argv;
  });
  afterEach(() => {
    process.argv = originalArgv;
  });

  it('parses --bare flag', () => {
    process.argv = ['node', 'cli', '--bare'];
    expect(parseCliArgs().bare).toBe(true);
  });

  it('defaults bare to false', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().bare).toBe(false);
  });

  it('parses --allowed-tools flag', () => {
    process.argv = ['node', 'cli', '--allowed-tools', 'Bash,Read,Write'];
    expect(parseCliArgs().allowedTools).toBe('Bash,Read,Write');
  });

  it('defaults allowedTools to undefined', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().allowedTools).toBeUndefined();
  });

  it('parses --no-session-persistence flag', () => {
    process.argv = ['node', 'cli', '--no-session-persistence'];
    expect(parseCliArgs().noSessionPersistence).toBe(true);
  });

  it('defaults noSessionPersistence to false', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().noSessionPersistence).toBe(false);
  });

  it('parses --json-schema flag', () => {
    process.argv = ['node', 'cli', '--json-schema', '{"type":"object"}'];
    expect(parseCliArgs().jsonSchema).toBe('{"type":"object"}');
  });

  it('defaults jsonSchema to undefined', () => {
    process.argv = ['node', 'cli'];
    expect(parseCliArgs().jsonSchema).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm --filter @robota-sdk/agent-cli test -- --reporter=verbose 2>&1 | grep -A3 "new non-interactive"
```

Expected: `TypeError: parseCliArgs().bare is not defined` 또는 `undefined !== true`

- [ ] **Step 3: `cli-args.ts` 수정**

`IParsedCliArgs` 인터페이스에 추가:

```ts
export interface IParsedCliArgs {
  // ... 기존 필드 ...
  bare: boolean;
  allowedTools: string | undefined;
  noSessionPersistence: boolean;
  jsonSchema: string | undefined;
}
```

`parseArgs` options에 추가:

```ts
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    // ... 기존 옵션 ...
    bare: { type: 'boolean', default: false },
    'allowed-tools': { type: 'string' },
    'no-session-persistence': { type: 'boolean', default: false },
    'json-schema': { type: 'string' },
  },
});
```

return 객체에 추가:

```ts
return {
  // ... 기존 필드 ...
  bare: values['bare'] ?? false,
  allowedTools: values['allowed-tools'],
  noSessionPersistence: values['no-session-persistence'] ?? false,
  jsonSchema: values['json-schema'],
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm --filter @robota-sdk/agent-cli test -- --reporter=verbose 2>&1 | grep -E "✓|✗|PASS|FAIL" | tail -20
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/agent-cli/src/utils/cli-args.ts packages/agent-cli/src/utils/__tests__/cli-args.test.ts
git commit -m "feat(agent-cli): add --bare, --allowed-tools, --no-session-persistence, --json-schema flags to cli-args"
```

---

## Task 2: SDK — `allowedTools` 옵션 추가 (`create-session.ts`)

**Files:**

- Modify: `packages/agent-sdk/src/assembly/create-session.ts`

- [ ] **Step 1: `ICreateSessionOptions`에 `allowedTools` 추가**

`ICreateSessionOptions` 인터페이스 끝에 추가:

```ts
/** Pre-approved tool names — added to permissions.allow as ToolName(*) patterns. */
allowedTools?: string[];
```

- [ ] **Step 2: `mergedPermissions` 로직 수정**

기존:

```ts
const mergedPermissions = {
  allow: [...defaultAllow, ...(options.config.permissions.allow ?? [])],
  deny: options.config.permissions.deny ?? [],
};
```

변경:

```ts
const allowedToolPatterns = (options.allowedTools ?? []).map((name) => `${name}(*)`);
const mergedPermissions = {
  allow: [...defaultAllow, ...(options.config.permissions.allow ?? []), ...allowedToolPatterns],
  deny: options.config.permissions.deny ?? [],
};
```

- [ ] **Step 3: 빌드 + 타입 체크**

```bash
pnpm --filter @robota-sdk/agent-sdk build 2>&1 | tail -10
pnpm --filter @robota-sdk/agent-sdk typecheck 2>&1 | tail -10
```

Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add packages/agent-sdk/src/assembly/create-session.ts
git commit -m "feat(agent-sdk): add allowedTools option to createSession — injects ToolName(*) allow patterns"
```

---

## Task 3: SDK — `bare` + `noSessionPersistence` 옵션 (`interactive-session-init.ts`)

**Files:**

- Modify: `packages/agent-sdk/src/interactive/interactive-session-init.ts`

- [ ] **Step 1: `IInteractiveSessionStandardOptions`에 옵션 추가**

```ts
export interface IInteractiveSessionStandardOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: SessionStore;
  sessionName?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  /** Skip AGENTS.md/CLAUDE.md loading and plugin discovery. */
  bare?: boolean;
  /** Pre-approved tool names (passed through to createSession). */
  allowedTools?: string[];
}
```

> `noSessionPersistence`는 CLI에서 `SessionStore`를 생성하지 않는 방식으로 처리하므로 여기에 추가하지 않는다.

- [ ] **Step 2: `IInitOptions`에 `bare`, `allowedTools` 추가**

```ts
export interface IInitOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  resumeSessionId?: string;
  forkSession?: boolean;
  onTextDelta: (delta: string) => void;
  onToolExecution: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: Record<string, unknown>;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }) => void;
  bare?: boolean;
  allowedTools?: string[];
}
```

- [ ] **Step 3: `createInteractiveSession`에서 `bare` 처리**

기존:

```ts
const [config, context, projectInfo] = await Promise.all([
  loadConfig(cwd),
  loadContext(cwd),
  detectProject(cwd),
]);
```

변경:

```ts
const [config, contextOrEmpty, projectInfo] = await Promise.all([
  loadConfig(cwd),
  options.bare ? Promise.resolve({ agentsMd: '', claudeMd: '' }) : loadContext(cwd),
  options.bare
    ? Promise.resolve({ type: 'unknown' as const, language: 'unknown' })
    : detectProject(cwd),
]);
const context = contextOrEmpty;
```

플러그인 로딩도 `bare` 시 스킵:

```ts
let mergedConfig = config;
if (!options.bare) {
  try {
    const plugins = pluginLoader.loadPluginsSync();
    if (plugins.length > 0) {
      const pluginHooks = mergePluginHooks(plugins);
      mergedConfig = {
        ...config,
        hooks: mergeHooksIntoConfig(
          config.hooks as Record<string, Array<Record<string, unknown>>> | undefined,
          pluginHooks as Record<string, Array<Record<string, unknown>>>,
        ),
      };
    }
  } catch {
    // No plugins dir or load failed
  }
}
```

`createSession` 호출에 `allowedTools` 추가:

```ts
return createSession({
  config: mergedConfig,
  context,
  projectInfo,
  permissionMode: options.permissionMode,
  maxTurns: options.maxTurns,
  terminal: NOOP_TERMINAL,
  sessionLogger: new FileSessionLogger(paths.logs),
  permissionHandler: options.permissionHandler,
  provider: options.provider,
  onTextDelta: options.onTextDelta,
  onToolExecution: options.onToolExecution,
  sessionId,
  allowedTools: options.allowedTools, // ← 추가
});
```

- [ ] **Step 4: `InteractiveSession` 생성자에서 옵션 전달**

`interactive-session.ts`의 `init` 메서드(또는 `createInteractiveSession` 호출부)에서 `bare`, `allowedTools`를 `IInitOptions`로 전달하는지 확인. `IInteractiveSessionStandardOptions`에서 `IInitOptions`로 매핑되는 위치를 찾아 추가.

`interactive-session.ts` 내 `IInteractiveSessionStandardOptions` → `IInitOptions` 변환 코드를 찾아서:

```ts
// 기존에 있는 매핑 코드 끝에 추가
bare: opts.bare,
allowedTools: opts.allowedTools,
```

- [ ] **Step 5: 빌드 + 타입 체크**

```bash
pnpm --filter @robota-sdk/agent-sdk build 2>&1 | tail -10
pnpm --filter @robota-sdk/agent-sdk typecheck 2>&1 | tail -10
```

Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add packages/agent-sdk/src/interactive/interactive-session-init.ts packages/agent-sdk/src/interactive/interactive-session.ts
git commit -m "feat(agent-sdk): add bare and allowedTools options to InteractiveSession"
```

---

## Task 4: `cli.ts` — print mode에 새 플래그 연결

**Files:**

- Modify: `packages/agent-cli/src/cli.ts`

- [ ] **Step 1: `--no-session-persistence` 처리**

기존 print mode 내 session 생성 코드:

```ts
const session = new InteractiveSession({
  cwd,
  provider,
  permissionMode: args.permissionMode ?? 'bypassPermissions',
  maxTurns: args.maxTurns,
  sessionStore,
  sessionName: args.sessionName,
});
```

변경:

```ts
const session = new InteractiveSession({
  cwd,
  provider,
  permissionMode: args.permissionMode ?? 'bypassPermissions',
  maxTurns: args.maxTurns,
  sessionStore: args.noSessionPersistence ? undefined : sessionStore,
  sessionName: args.sessionName,
  bare: args.bare,
  allowedTools: args.allowedTools ? args.allowedTools.split(',').map((t) => t.trim()) : undefined,
});
```

- [ ] **Step 2: `--json-schema` 처리**

`--json-schema`는 `appendSystemPrompt`에 주입한다. `createHeadlessTransport` 호출 전:

```ts
const baseAppend = args.appendSystemPrompt ?? '';
const schemaAppend = args.jsonSchema
  ? `\nRespond with valid JSON only, matching this JSON schema:\n${args.jsonSchema}`
  : '';
const finalAppend = (baseAppend + schemaAppend).trim() || undefined;

const transport = createHeadlessTransport({
  outputFormat: (args.outputFormat as 'text' | 'json' | 'stream-json') ?? 'text',
  prompt,
  appendSystemPrompt: finalAppend,
});
```

> `createHeadlessTransport`가 `appendSystemPrompt`를 지원하는지 확인 필요. 지원하지 않으면 headless transport SPEC에 없는 기능이므로 `session`에 직접 적용: `InteractiveSession` 생성자에 `appendSystemPrompt` 옵션을 추가하거나, 이미 있는 경우 활용.

**대안**: `--json-schema`를 `args.appendSystemPrompt`와 합쳐서 기존 `appendSystemPrompt` 경로로 전달:

```ts
// headless transport 호출 전 args를 수정하지 않고,
// session 생성 시 appendSystemPrompt 주입
const schemaInstruction = args.jsonSchema
  ? `Respond with valid JSON only, matching this JSON schema:\n${args.jsonSchema}`
  : undefined;
```

현재 `InteractiveSession`이 `appendSystemPrompt`를 지원하지 않는 경우, 이 태스크에서 추가한다:

`IInteractiveSessionStandardOptions`에:

```ts
appendSystemPrompt?: string;
```

`IInitOptions`에:

```ts
appendSystemPrompt?: string;
```

`createSession`의 `systemMessage` 빌드 후:

```ts
const systemMessage = buildPrompt({ ... });
const finalSystemMessage = options.appendSystemPrompt
  ? systemMessage + '\n\n' + options.appendSystemPrompt
  : systemMessage;
```

그리고 `new Session({ systemMessage: finalSystemMessage, ... })` 로 변경.

- [ ] **Step 3: 빌드 + 타입 체크**

```bash
pnpm --filter @robota-sdk/agent-cli build 2>&1 | tail -10
pnpm --filter @robota-sdk/agent-cli typecheck 2>&1 | tail -10
```

Expected: 오류 없음

- [ ] **Step 4: 수동 smoke test — bare 모드**

```bash
# 실제 API 호출 없이 타입/런타임 오류 없음 확인
node packages/agent-cli/dist/bin.js -p --bare --help 2>&1 || true
```

- [ ] **Step 5: 커밋**

```bash
git add packages/agent-cli/src/cli.ts
git commit -m "feat(agent-cli): wire --bare, --allowed-tools, --no-session-persistence, --json-schema to print mode"
```

---

## Task 5: 전체 빌드 + lint + 타입 체크 통과

- [ ] **Step 1: 전체 빌드**

```bash
pnpm build 2>&1 | tail -20
```

Expected: 빌드 오류 없음

- [ ] **Step 2: typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: 타입 오류 없음

- [ ] **Step 3: lint**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: lint 오류 없음

- [ ] **Step 4: 전체 테스트**

```bash
pnpm test 2>&1 | tail -30
```

Expected: 기존 테스트 모두 통과, 새 테스트 통과

- [ ] **Step 5: CLI-BL-017 태스크 완료 커밋**

```bash
git add .
git commit -m "chore: CLI-BL-017 non-interactive advanced flags complete"
```

---

## 스코프 외 (향후 태스크)

- `--json-schema` JSON 스키마 유효성 검증 (ajv 등 라이브러리 사용)
- `--allowed-tools` 툴 이름 대소문자 자동 정규화 (`bash` → `Bash`)
- interactive 모드에서 `--bare` 지원

---

## Self-Review

**Spec coverage:**

- [x] `--bare`: Task 3에서 SDK 옵션 추가, Task 4에서 CLI 연결
- [x] `--allowed-tools`: Task 1 (파싱), Task 2 (permissions.allow 주입), Task 3 (SDK 전달), Task 4 (CLI 연결)
- [x] `--no-session-persistence`: Task 1 (파싱), Task 4 (CLI에서 SessionStore 조건부 생성)
- [x] `--json-schema`: Task 1 (파싱), Task 4 (appendSystemPrompt 주입)

**Ambiguity:**

- Task 4 Step 2에서 `appendSystemPrompt`가 `InteractiveSession`에 없을 수 있음 → 조건부 구현 절차 명시함
- `--allowed-tools` 툴 이름 대소문자: 현재 사용자가 정확한 이름(`Bash`, `Read`) 입력 가정. 정규화는 스코프 외로 명시.
