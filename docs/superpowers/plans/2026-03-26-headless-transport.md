# Headless Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New `@robota-sdk/agent-transport-headless` package for non-interactive execution with JSON/stream-json output, stdin pipe, exit codes, and system prompt injection.

**Architecture:** Transport adapter pattern matching transport-http/ws/mcp. `createHeadlessRunner()` factory wraps InteractiveSession events into stdout output. CLI replaces inline print mode with this package.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Scaffold agent-transport-headless package

**Files:**

- Create: `packages/agent-transport-headless/package.json`
- Create: `packages/agent-transport-headless/tsconfig.json`
- Create: `packages/agent-transport-headless/src/index.ts`
- Create: `packages/agent-transport-headless/src/headless-runner.ts`

- [ ] **Step 1: Create package.json**

Copy from `packages/agent-transport-http/package.json` and adapt:

- name: `@robota-sdk/agent-transport-headless`
- description: `Headless transport adapter for non-interactive InteractiveSession execution`
- dependencies: only `@robota-sdk/agent-sdk: workspace:*`
- Remove `hono` dependency
- Add `prepublishOnly` script: `bash ../../scripts/check-pnpm-publish.sh`

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create empty index.ts**

```typescript
export { createHeadlessRunner } from './headless-runner.js';
export type { IHeadlessRunnerOptions, TOutputFormat } from './headless-runner.js';
```

- [ ] **Step 4: Create headless-runner.ts stub**

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

export type TOutputFormat = 'text' | 'json' | 'stream-json';

export interface IHeadlessRunnerOptions {
  session: InteractiveSession;
  outputFormat: TOutputFormat;
}

export function createHeadlessRunner(_options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
} {
  return {
    run: async (_prompt: string) => 0,
  };
}
```

- [ ] **Step 5: Add to changeset config**

Add `@robota-sdk/agent-transport-headless` to `.changeset/config.json` fixed group.

- [ ] **Step 6: Install and build**

```bash
pnpm install
pnpm --filter @robota-sdk/agent-transport-headless build
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent-transport-headless/ .changeset/config.json
git commit -m "feat: scaffold agent-transport-headless package"
```

---

### Task 2: Implement text output format

**Files:**

- Modify: `packages/agent-transport-headless/src/headless-runner.ts`
- Create: `packages/agent-transport-headless/src/__tests__/headless-runner.test.ts`

- [ ] **Step 1: Write failing test — text format outputs response to stdout**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createHeadlessRunner } from '../headless-runner.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

function createMockSession(response: string) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    submit: vi.fn(async () => {
      // Simulate complete event
      for (const h of listeners.get('complete') ?? []) {
        h({ response, history: [], toolSummaries: [], contextState: {} });
      }
    }),
    getSession: vi.fn(() => ({ getSessionId: () => 'test-session-id' })),
  } as unknown as InteractiveSession;
}

describe('createHeadlessRunner', () => {
  it('text format writes response to stdout', async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as never;

    const session = createMockSession('Hello world');
    const runner = createHeadlessRunner({ session, outputFormat: 'text' });
    const exitCode = await runner.run('test prompt');

    process.stdout.write = originalWrite;

    expect(exitCode).toBe(0);
    expect(writes.join('')).toContain('Hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-transport-headless test -- --run`

- [ ] **Step 3: Implement text format**

```typescript
export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
} {
  const { session, outputFormat } = options;

  return {
    run: async (prompt: string): Promise<number> => {
      return new Promise<number>((resolve) => {
        session.on('complete', (result) => {
          if (outputFormat === 'text') {
            process.stdout.write(result.response + '\n');
          }
          resolve(0);
        });

        session.on('interrupted', (result) => {
          if (outputFormat === 'text' && result.response) {
            process.stdout.write(result.response + '\n');
          }
          resolve(0);
        });

        session.on('error', () => {
          resolve(1);
        });

        session.submit(prompt).catch(() => resolve(1));
      });
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-transport-headless): implement text output format"
```

---

### Task 3: Implement JSON output format

**Files:**

- Modify: `packages/agent-transport-headless/src/headless-runner.ts`
- Modify: `packages/agent-transport-headless/src/__tests__/headless-runner.test.ts`

- [ ] **Step 1: Write failing test — json format outputs structured JSON**

```typescript
it('json format outputs { type, result, session_id, subtype }', async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = vi.fn((chunk: string) => {
    writes.push(chunk);
    return true;
  }) as never;

  const session = createMockSession('JSON response');
  const runner = createHeadlessRunner({ session, outputFormat: 'json' });
  await runner.run('test');

  process.stdout.write = originalWrite;

  const output = JSON.parse(writes.join(''));
  expect(output.type).toBe('result');
  expect(output.result).toBe('JSON response');
  expect(output.session_id).toBe('test-session-id');
  expect(output.subtype).toBe('success');
});

it('json format outputs subtype error on failure', async () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const session = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    submit: vi.fn(async () => {
      for (const h of listeners.get('error') ?? []) {
        h(new Error('API failure'));
      }
    }),
    getSession: vi.fn(() => ({ getSessionId: () => 'err-session' })),
  } as unknown as InteractiveSession;

  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = vi.fn((chunk: string) => {
    writes.push(chunk);
    return true;
  }) as never;

  const runner = createHeadlessRunner({ session, outputFormat: 'json' });
  const exitCode = await runner.run('test');

  process.stdout.write = originalWrite;

  expect(exitCode).toBe(1);
  const output = JSON.parse(writes.join(''));
  expect(output.subtype).toBe('error');
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add JSON output to headless-runner.ts**

In the `complete` handler:

```typescript
if (outputFormat === 'json') {
  const sessionId = session.getSession().getSessionId();
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      result: result.response,
      session_id: sessionId,
      subtype: 'success',
    }) + '\n',
  );
}
```

In the `error` handler:

```typescript
if (outputFormat === 'json') {
  const sessionId = session.getSession().getSessionId();
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      result: '',
      session_id: sessionId,
      subtype: 'error',
    }) + '\n',
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-transport-headless): implement JSON output format"
```

---

### Task 4: Implement stream-json output format

**Files:**

- Modify: `packages/agent-transport-headless/src/headless-runner.ts`
- Modify: `packages/agent-transport-headless/src/__tests__/headless-runner.test.ts`

- [ ] **Step 1: Write failing test — stream-json emits text_delta events + result**

```typescript
it('stream-json emits content_block_delta events and final result', async () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const session = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
    }),
    off: vi.fn(),
    submit: vi.fn(async () => {
      for (const h of listeners.get('text_delta') ?? []) {
        h('Hello');
        h(' world');
      }
      for (const h of listeners.get('complete') ?? []) {
        h({ response: 'Hello world', history: [], toolSummaries: [], contextState: {} });
      }
    }),
    getSession: vi.fn(() => ({ getSessionId: () => 'stream-session' })),
  } as unknown as InteractiveSession;

  const lines: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = vi.fn((chunk: string) => {
    lines.push(chunk.toString().trim());
    return true;
  }) as never;

  const runner = createHeadlessRunner({ session, outputFormat: 'stream-json' });
  await runner.run('test');

  process.stdout.write = originalWrite;

  const events = lines.filter((l) => l.length > 0).map((l) => JSON.parse(l));
  const deltas = events.filter((e) => e.type === 'stream_event');
  const result = events.find((e) => e.type === 'result');

  expect(deltas.length).toBe(2);
  expect(deltas[0].event.delta.text).toBe('Hello');
  expect(deltas[1].event.delta.text).toBe(' world');
  expect(result.result).toBe('Hello world');
  expect(result.subtype).toBe('success');
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add stream-json to headless-runner.ts**

Subscribe to `text_delta` event:

```typescript
if (outputFormat === 'stream-json') {
  session.on('text_delta', (delta: string) => {
    const sessionId = session.getSession().getSessionId();
    process.stdout.write(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: delta },
        },
        session_id: sessionId,
        uuid: randomUUID(),
      }) + '\n',
    );
  });
}
```

Final result in `complete` handler same as JSON format.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-transport-headless): implement stream-json output format"
```

---

### Task 5: Add CLI flags and stdin pipe

**Files:**

- Modify: `packages/agent-cli/src/utils/cli-args.ts`
- Modify: `packages/agent-cli/src/cli.ts`
- Modify: `packages/agent-cli/package.json`
- Test: `packages/agent-cli/src/utils/__tests__/cli-args.test.ts`

- [ ] **Step 1: Write failing test — new CLI flags**

```typescript
it('parses --output-format flag', () => {
  process.argv = ['node', 'cli', '-p', '--output-format', 'json', 'test prompt'];
  const args = parseCliArgs();
  expect(args.outputFormat).toBe('json');
});

it('parses --system-prompt flag', () => {
  process.argv = ['node', 'cli', '-p', '--system-prompt', 'You are helpful', 'test'];
  const args = parseCliArgs();
  expect(args.systemPrompt).toBe('You are helpful');
});

it('parses --append-system-prompt flag', () => {
  process.argv = ['node', 'cli', '-p', '--append-system-prompt', 'Focus on tests', 'test'];
  const args = parseCliArgs();
  expect(args.appendSystemPrompt).toBe('Focus on tests');
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add flags to cli-args.ts**

Add to `IParsedCliArgs`:

```typescript
outputFormat: string | undefined;
systemPrompt: string | undefined;
appendSystemPrompt: string | undefined;
```

Add to parseArgs options:

```typescript
'output-format': { type: 'string' },
'system-prompt': { type: 'string' },
'append-system-prompt': { type: 'string' },
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Add agent-transport-headless dependency**

In `packages/agent-cli/package.json` add:

```json
"@robota-sdk/agent-transport-headless": "workspace:*"
```

- [ ] **Step 6: Replace inline print mode in cli.ts**

```typescript
import { createHeadlessRunner } from '@robota-sdk/agent-transport-headless';

if (args.printMode) {
  // Read prompt from args or stdin
  let prompt = args.positional.join(' ').trim();
  if (!prompt && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    prompt = Buffer.concat(chunks).toString('utf-8').trim();
  }
  if (!prompt) {
    process.stderr.write('Print mode (-p) requires a prompt argument.\n');
    process.exit(1);
  }

  const session = new InteractiveSession({
    cwd,
    provider,
    permissionMode: args.permissionMode ?? 'bypassPermissions',
    maxTurns: args.maxTurns,
    sessionStore,
    sessionName: args.sessionName,
  });

  const runner = createHeadlessRunner({
    session,
    outputFormat: (args.outputFormat as 'text' | 'json' | 'stream-json') ?? 'text',
  });

  const exitCode = await runner.run(prompt);
  process.exit(exitCode);
}
```

- [ ] **Step 7: Build and test**

```bash
pnpm install
pnpm --filter @robota-sdk/agent-transport-headless build
pnpm --filter @robota-sdk/agent-cli build
pnpm --filter @robota-sdk/agent-cli test -- --run
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(agent-cli): replace inline print mode with headless transport + add CLI flags"
```

---

### Task 6: SPEC, README, content/ documentation

**Files:**

- Create: `packages/agent-transport-headless/docs/SPEC.md`
- Create: `packages/agent-transport-headless/README.md`
- Modify: `packages/agent-cli/docs/SPEC.md`
- Modify: `packages/agent-cli/README.md`
- Modify: `content/guide/cli.md`

- [ ] **Step 1: Create transport-headless SPEC.md**

Document: scope, boundaries, public API (`createHeadlessRunner`), output formats (text/json/stream-json), IHeadlessRunnerOptions, dependencies.

- [ ] **Step 2: Create transport-headless README.md**

Quick reference: installation, usage examples for each output format, dependency.

- [ ] **Step 3: Update agent-cli SPEC.md**

Add `--output-format`, `--system-prompt`, `--append-system-prompt` flags. Document stdin pipe behavior. Document exit codes (0 success, 1 error). Note that print mode now delegates to `agent-transport-headless`.

- [ ] **Step 4: Update agent-cli README.md**

Add new flags to usage section.

- [ ] **Step 5: Update content/guide/cli.md**

Add headless/non-interactive section with examples.

- [ ] **Step 6: Build and full test**

```bash
pnpm --filter @robota-sdk/agent-transport-headless build
pnpm --filter @robota-sdk/agent-transport-headless test -- --run
pnpm --filter @robota-sdk/agent-cli build
pnpm --filter @robota-sdk/agent-cli test -- --run
```

- [ ] **Step 7: Commit**

```bash
git commit -m "docs: SPEC, README, content/ for headless transport and CLI flags"
```
