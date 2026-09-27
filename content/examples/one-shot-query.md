# One-Shot Query

`createQuery()` is the shortest way to drive a full agent session from code: it returns a function
that takes a prompt and resolves with the agent's final answer. The session behind it has the built-in
tools (file, shell, search) working in `cwd`.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const query = createQuery({ provider });

const response = await query('What files are in this project?');
console.log(response);
```

`createQuery()` builds one session, and every call to the returned function adds a turn to that same
session, so a later prompt sees the earlier ones. For an independent conversation, call
`createQuery()` again. To drive the session yourself (events, abort, persistence), use
[`InteractiveSession`](./session-management.md).

## Options

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const query = createQuery({
  provider,
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 5,
  onTextDelta: (delta) => process.stdout.write(delta),
  // Asked for anything the permission mode does not decide on its own, such as a shell command.
  permissionHandler: async (toolName, toolArgs) =>
    ['Bash', 'Shell'].includes(toolName) && String(toolArgs.command).startsWith('pnpm test'),
});

const response = await query('Refactor the error handling in src/utils.ts and run the tests');
```

- `permissionMode` defaults to `default`. With no `permissionHandler`, a tool call that would ask for
  approval is denied. See the [permissions guide](../guide/permissions-and-hooks.md) for what each
  mode allows.
- Without a `projectAccess` decision the session runs Restricted: its tools still work inside `cwd`,
  but it does not load the project's `AGENTS.md`/`CLAUDE.md`, settings or memory. The
  [agent-framework README](../../packages/agent-framework/README.md) describes how a host passes
  project access.

## In a script

```typescript
#!/usr/bin/env tsx
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const task = process.argv[2];
if (!task) {
  console.error('Usage: script.ts "task description"');
  process.exit(1);
}

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
// No one is there to approve tool calls, so the script states the wider mode it needs.
const query = createQuery({ provider, permissionMode: 'bypassPermissions', maxTurns: 20 });

console.log(await query(task));
```

[examples/cli](../../examples/cli/README.md) is a runnable version that streams the answer and also
reads the prompt from stdin.
