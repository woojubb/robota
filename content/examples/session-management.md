# Session Management

Multi-turn sessions with permissions, context tracking, and compaction.

## Using InteractiveSession (Recommended)

```typescript
import { InteractiveSession, createUserSessionStore } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const sessionStore = createUserSessionStore();
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore, // auto-persist after each submit
  sessionName: 'my-task', // optional name
});

// Submit prompts
await session.submit('What is the architecture?');
await session.submit('Show me the main entry point.');

// Session name
session.setName('architecture-review');
console.log(session.getName()); // 'architecture-review'

// Resume a previous session
const resumed = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore,
  resumeSessionId: 'session_abc123', // restores history + AI context
});

// Fork a session (new ID, same context)
const forked = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore,
  resumeSessionId: 'session_abc123',
  forkSession: true,
});
```

## Recovery log failures

The project session store can recover from its append-only log when a snapshot is missing. It first
validates the versioned JSONL and every event payload. A damaged log is reported as `corrupt`; an
unsupported version is reported as `unsupported`. Such logs remain visible in store listings rather
than disappearing as missing sessions, and valid lines are not used as a partial substitute for a
damaged log. A corrupt snapshot never falls back to replay.

New logs carry schema version 1. Unversioned legacy logs are not accepted by the replay codec; this
change does not alter the session snapshot format. Direct log readers and the replay provider raise
`SessionLogDecodeError` with a safe field/line location. External-payload integrity failures retain
their existing typed errors.

## Using InteractiveSession Events

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

// Multi-turn conversation. submit() queues automatically if a run is active.
await session.submit('What is the architecture of this project?');
await session.submit('Show me the main entry point.');
await session.submit('What tests exist?');

// Check context usage
const state = session.getContextState();
console.log(`Context: ${state.usedPercentage.toFixed(1)}% used`);

// Manual compaction with focus
if (state.usedPercentage > 70) {
  await session.executeCommand('compact', 'Focus on the architecture discussion');
}

// Session metadata
console.log(`Messages: ${session.getFullHistory().length}`);
console.log(`Mode: ${session.getSession().getPermissionMode()}`);

// Change permission mode
session.getSession().setPermissionMode('acceptEdits');

// Abort a long-running request
setTimeout(() => session.abort(), 30000);
```

## Session Persistence

```typescript
import { InteractiveSession, createUserSessionStore } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const store = createUserSessionStore();
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sessions auto-persist when a store is provided
const session = new InteractiveSession({
  cwd: process.cwd(),
  provider,
  sessionStore: store,
});

await session.submit('Hello');

// Later — list and resume sessions
const sessions = store.list();
const record = store.load(sessions[0].id);
```

## CLI Session Management

```bash
# Continue last session
robota -c

# Resume specific session (by name or ID)
robota -r my-feature

# Fork from existing session (new ID, same context)
robota -c --fork-session
robota -r my-feature --fork-session

# Name a session
robota --name "auth-refactor"
```

## TUI Commands

```bash
# Inside TUI:
/resume          # Show session picker
/rename my-task  # Rename current session
```

## Session Name

Session name appears in three places: input box border, terminal title, status bar.
