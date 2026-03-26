# Session Management

Multi-turn sessions with permissions, context tracking, and compaction.

## Using InteractiveSession (Recommended)

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { SessionStore } from '@robota-sdk/agent-sessions';

const sessionStore = new SessionStore();

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

## Using Session Directly (Advanced)

```typescript
import { createSession, loadConfig, loadContext, detectProject } from '@robota-sdk/agent-sdk';

const cwd = process.cwd();
const [config, context, projectInfo] = await Promise.all([
  loadConfig(cwd),
  loadContext(cwd),
  detectProject(cwd),
]);

const session = createSession({
  config,
  context,
  terminal,
  projectInfo,
  permissionMode: 'default',
  onTextDelta: (delta) => process.stdout.write(delta),
  onCompact: (summary) => console.log('\n[Context compacted]'),
});

// Multi-turn conversation
await session.run('What is the architecture of this project?');
await session.run('Show me the main entry point.');
await session.run('What tests exist?');

// Check context usage
const state = session.getContextState();
console.log(`Context: ${state.usedPercentage.toFixed(1)}% used`);

// Manual compaction with focus
if (state.usedPercentage > 70) {
  await session.compact('Focus on the architecture discussion');
}

// Session metadata
console.log(`Session: ${session.getSessionId()}`);
console.log(`Messages: ${session.getMessageCount()}`);
console.log(`Mode: ${session.getPermissionMode()}`);

// Change permission mode
session.setPermissionMode('acceptEdits');

// Abort a long-running request
setTimeout(() => session.abort(), 30000);
```

## Session Persistence

```typescript
import { SessionStore } from '@robota-sdk/agent-sessions';

const store = new SessionStore();

// Sessions auto-persist when a store is provided
const session = createSession({
  config,
  context,
  terminal,
  sessionStore: store,
});

await session.run('Hello');

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
robota --resume

# Fork from existing session (new ID, same context)
robota -c --fork-session

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
