# Session Management

`InteractiveSession` is the event-driven session every Robota surface is built on. It keeps the
conversation, runs the built-in tools under a permission mode, tracks the context window, and can save
and resume itself through a session store.

## Events and context

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  permissionMode: 'default',
});

session.on('text_delta', (delta) => process.stdout.write(delta));
session.on('context_update', (state) => {
  console.log(`Context: ${state.usedPercentage.toFixed(1)}% used`);
});
session.on('complete', ({ response }) => {
  console.log('\n--- Complete response ---');
  console.log(response);
});

// submit() resolves after the turn when the session is idle; while a turn runs, a new
// submission is queued and submit() resolves at once. `completed` settles with this turn's result.
const { completed } = await session.submit('What is the architecture of this project?');
const result = await completed;
console.log(result.response.length, 'characters');

await session.submit('Show me the main entry point.');

// Compact the conversation, with instructions for what to keep
const state = session.getContextState();
if (state.usedPercentage > 70) {
  await session.compactContext('Focus on the architecture discussion');
}

console.log(`History entries: ${session.getFullHistory().length}`);
console.log(`Mode: ${session.getSession().getPermissionMode()}`);

// Change the permission mode for the next tool calls
session.getSession().setPermissionMode('acceptEdits');

// Abort the running turn
setTimeout(() => session.abort(), 30000);
```

In `default` mode a tool call that needs approval emits `permission_request`; answer it with
`session.resolvePermission(id, result)`. If nothing is listening, the call is denied. The
[permissions guide](../guide/permissions-and-hooks.md) describes each mode.

Without a `projectAccess` decision the session runs Restricted: its tools still work inside `cwd`,
but it does not load the project's `AGENTS.md`/`CLAUDE.md`, settings or memory. The
[agent-framework README](../../packages/agent-framework/README.md) describes how a host passes project
access.

## Persist and resume

Give the session a store and it saves itself after each turn. `createUserSessionStore()` keeps the
records in a directory you choose.

```typescript
import { InteractiveSession, createUserSessionStore } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { homedir } from 'node:os';
import { join } from 'node:path';

const sessionStore = createUserSessionStore(join(homedir(), '.my-agent', 'sessions'));
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore,
  sessionName: 'my-task',
});

await session.submit('What is the architecture?');
const sessionId = session.getSession().getSessionId();

session.setName('architecture-review');
console.log(session.getName()); // 'architecture-review'

// Resume: restores the history and the model's context
const resumed = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore,
  resumeSessionId: sessionId,
});

// Fork: a new session ID that starts from the same history
const forked = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore,
  resumeSessionId: sessionId,
  forkSession: true,
});
```

[examples/telegram-bot](../../examples/telegram-bot/README.md) resumes one saved session per chat this
way.

## Reading the store

`load()` and `list()` report why a record cannot be used instead of hiding it: each outcome is
`valid`, `missing`, `corrupt` (present but not a session record) or `unsupported` (written by a
version this one does not read). Only a `valid` outcome carries the record.

```typescript
import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { homedir } from 'node:os';
import { join } from 'node:path';

const sessionStore = createUserSessionStore(join(homedir(), '.my-agent', 'sessions'));

for (const entry of sessionStore.list()) {
  const { outcome } = entry;
  if (outcome.status === 'valid') {
    console.log(entry.id, outcome.record.name ?? '(unnamed)', outcome.record.updatedAt);
  } else {
    console.log(entry.id, `cannot be resumed: ${outcome.status}`);
  }
}

const outcome = sessionStore.load('session-id');
if (outcome.status === 'valid') {
  console.log(`${outcome.record.messages.length} messages`);
}
```

A project session store (`createProjectSessionStore()`, built on a trusted workspace's state
directories) also keeps an append-only log and can rebuild a session from it when the saved record is
missing. A damaged log is reported as `corrupt` rather than partly replayed.

## From the CLI

```bash
# Continue the most recent session
__PRODUCT_CLI_NAME__ -c

# Resume a session by name or ID
__PRODUCT_CLI_NAME__ -r my-feature

# Fork into a new session with the same history
__PRODUCT_CLI_NAME__ -c --fork-session
__PRODUCT_CLI_NAME__ -r my-feature --fork-session

# Name a new session
__PRODUCT_CLI_NAME__ --name "auth-refactor"
```

Inside the terminal UI, `/resume` opens a session picker and `/rename <name>` renames the current
session. The session name appears on the input box border, in the terminal title and in the status
line.
