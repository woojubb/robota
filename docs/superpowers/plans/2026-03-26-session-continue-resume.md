# Session Continue/Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to resume previous conversations with full AI context and UI history restoration.

**Architecture:** Wire existing SessionStore into InteractiveSession so sessions auto-persist. Add restore path for `--continue`/`--resume`. Add ListPicker component for session selection UI. Add `/resume` and `/rename` system commands.

**Tech Stack:** TypeScript, Ink (React), Vitest

---

### Task 1: Extend ISessionRecord with history field

**Files:**

- Modify: `packages/agent-sessions/src/session-store.ts:12-25`
- Modify: `packages/agent-sessions/src/session.ts:404-421`
- Test: `packages/agent-sdk/src/__tests__/session-store.test.ts`

- [ ] **Step 1: Write failing test — ISessionRecord saves and loads history**

```typescript
// In packages/agent-sdk/src/__tests__/session-store.test.ts (or agent-sessions test)
it('saves and loads IHistoryEntry[] in history field', () => {
  const store = new SessionStore(tmpDir);
  const history = [
    {
      id: '1',
      timestamp: new Date().toISOString(),
      category: 'chat',
      type: 'user',
      data: { role: 'user', content: 'hello' },
    },
    {
      id: '2',
      timestamp: new Date().toISOString(),
      category: 'event',
      type: 'tool-summary',
      data: { tools: [], summary: '✓ Read' },
    },
    {
      id: '3',
      timestamp: new Date().toISOString(),
      category: 'chat',
      type: 'assistant',
      data: { role: 'assistant', content: 'world' },
    },
  ];

  const record = {
    id: 'test-session',
    cwd: '/tmp',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ],
    history,
  };

  store.save(record);
  const loaded = store.load('test-session');
  expect(loaded).toBeDefined();
  expect(loaded!.history).toHaveLength(3);
  expect(loaded!.history[0].category).toBe('chat');
  expect(loaded!.history[1].type).toBe('tool-summary');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-sessions test -- --run`
Expected: FAIL — `history` field not in ISessionRecord type

- [ ] **Step 3: Add history field to ISessionRecord**

In `packages/agent-sessions/src/session-store.ts`, add to interface:

```typescript
export interface ISessionRecord {
  id: string;
  name?: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: unknown[];
  /** Full UI timeline (chat + events) for rendering restoration */
  history?: unknown[];
}
```

Use `unknown[]` since agent-sessions does not depend on agent-core's IHistoryEntry.

- [ ] **Step 4: Update Session.persistSession() to include history**

In `packages/agent-sessions/src/session.ts:404-421`, update persistSession:

```typescript
private persistSession(): void {
  if (!this.sessionStore) return;

  const history = this.robota.getHistory();
  const now = new Date().toISOString();
  const existing = this.sessionStore.load(this.sessionId);

  const record: ISessionRecord = {
    id: this.sessionId,
    name: existing?.name,
    cwd: this.cwd,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: history,
  };

  this.sessionStore.save(record);
}
```

Note: `history` (IHistoryEntry[]) will be set by InteractiveSession, not Session. Session preserves existing `name` and sets `messages`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/agent-sessions test -- --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-sessions/src/session-store.ts packages/agent-sessions/src/session.ts
git commit -m "feat(agent-sessions): add history field to ISessionRecord"
```

---

### Task 2: Wire SessionStore into InteractiveSession

**Files:**

- Modify: `packages/agent-sdk/src/interactive/interactive-session.ts:102-158`
- Test: `packages/agent-sdk/src/interactive/__tests__/interactive-session-behavior.test.ts`

- [ ] **Step 1: Write failing test — InteractiveSession persists session**

```typescript
it('auto-persists session to SessionStore after submit', async () => {
  const mockSessionStore = {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(undefined),
    list: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  };

  const session = new InteractiveSession({
    session: createMockSession({ runResult: 'hello' }) as never,
    sessionStore: mockSessionStore,
  } as never);

  await session.submit('test');

  expect(mockSessionStore.save).toHaveBeenCalled();
  const savedRecord = mockSessionStore.save.mock.calls[0][0];
  expect(savedRecord.history).toBeDefined();
  expect(savedRecord.history.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-sdk test -- --run -t "auto-persists"`
Expected: FAIL — sessionStore not accepted by InteractiveSession

- [ ] **Step 3: Add SessionStore wiring to InteractiveSession**

In `packages/agent-sdk/src/interactive/interactive-session.ts`:

1. Add `sessionStore` to options interface:

```typescript
interface IInteractiveSessionStandardOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: ICreateSessionOptions['permissionMode'];
  maxTurns?: number;
  permissionHandler?: TInteractivePermissionHandler;
  sessionStore?: SessionStore;
  sessionName?: string;
}
```

2. Store reference in constructor:

```typescript
private sessionStore?: SessionStore;
private sessionName?: string;
```

3. Pass to createSession in initializeAsync:

```typescript
this.session = createSession({
  ...existingOptions,
  sessionStore: options.sessionStore,
});
```

4. After executePrompt completes (in finally block), persist history:

```typescript
if (this.sessionStore) {
  const existing = this.sessionStore.load(this.getSession().getSessionId());
  this.sessionStore.save({
    id: this.getSession().getSessionId(),
    name: this.sessionName ?? existing?.name,
    cwd: options.cwd ?? '',
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: this.getSession().getHistory(),
    history: this.history,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/agent-sdk test -- --run -t "auto-persists"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-sdk/src/interactive/interactive-session.ts
git commit -m "feat(agent-sdk): wire SessionStore into InteractiveSession for auto-persist"
```

---

### Task 3: Add session restore to InteractiveSession

**Files:**

- Modify: `packages/agent-sdk/src/interactive/interactive-session.ts`
- Test: `packages/agent-sdk/src/interactive/__tests__/interactive-session-behavior.test.ts`

- [ ] **Step 1: Write failing test — loadSession restores history and messages**

```typescript
it('loadSession restores history and AI context', async () => {
  const savedHistory = [
    messageToHistoryEntry(createUserMessage('previous question')),
    messageToHistoryEntry(createAssistantMessage('previous answer')),
  ];
  const savedMessages = [
    { role: 'user', content: 'previous question' },
    { role: 'assistant', content: 'previous answer' },
  ];

  const mockSessionStore = {
    save: vi.fn(),
    load: vi.fn().mockReturnValue({
      id: 'prev-session',
      cwd: '/tmp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: savedHistory,
      messages: savedMessages,
    }),
    list: vi.fn().mockReturnValue([]),
    delete: vi.fn(),
  };

  const session = new InteractiveSession({
    session: createMockSession() as never,
    sessionStore: mockSessionStore,
    resumeSessionId: 'prev-session',
  } as never);

  const history = session.getFullHistory();
  expect(history).toHaveLength(2);
  expect(history[0].type).toBe('user');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-sdk test -- --run -t "loadSession"`
Expected: FAIL — resumeSessionId not supported

- [ ] **Step 3: Implement session restore**

In InteractiveSession constructor, after session is set:

```typescript
if ('resumeSessionId' in options && options.resumeSessionId && this.sessionStore) {
  const record = this.sessionStore.load(options.resumeSessionId);
  if (record) {
    this.history = record.history ?? [];
    this.sessionName = record.name;
    // Inject messages into underlying Session's Robota for AI context
    for (const msg of record.messages) {
      this.session.injectMessage(msg);
    }
  }
}
```

Add `resumeSessionId?: string` and `forkSession?: boolean` to options interfaces.

When `forkSession` is true, generate a new session ID instead of reusing the loaded one.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/agent-sdk test -- --run -t "loadSession"`
Expected: PASS

- [ ] **Step 5: Add getName/setName methods**

```typescript
getName(): string | undefined {
  return this.sessionName;
}

setName(name: string): void {
  this.sessionName = name;
  // Persist immediately
  if (this.sessionStore && this.session) {
    const id = this.getSession().getSessionId();
    const existing = this.sessionStore.load(id);
    if (existing) {
      existing.name = name;
      existing.updatedAt = new Date().toISOString();
      this.sessionStore.save(existing);
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-sdk/src/interactive/interactive-session.ts
git commit -m "feat(agent-sdk): add session restore + getName/setName to InteractiveSession"
```

---

### Task 4: Add CLI flags and session resolution

**Files:**

- Modify: `packages/agent-cli/src/utils/cli-args.ts`
- Modify: `packages/agent-cli/src/cli.ts`
- Test: `packages/agent-cli/src/utils/__tests__/cli-args.test.ts`

- [ ] **Step 1: Write failing test — new CLI flags parse correctly**

```typescript
it('parses --fork-session flag', () => {
  process.argv = ['node', 'cli', '--fork-session'];
  const args = parseCliArgs();
  expect(args.forkSession).toBe(true);
});

it('parses --name flag', () => {
  process.argv = ['node', 'cli', '--name', 'my-session'];
  const args = parseCliArgs();
  expect(args.sessionName).toBe('my-session');
});

it('parses -r without argument as resume picker', () => {
  process.argv = ['node', 'cli', '-r'];
  const args = parseCliArgs();
  expect(args.resumeId).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run -t "fork-session"`
Expected: FAIL

- [ ] **Step 3: Add flags to cli-args.ts**

```typescript
export interface IParsedCliArgs {
  // ... existing fields
  forkSession: boolean;
  sessionName: string | undefined;
}
```

Add to parseArgs options:

```typescript
'fork-session': { type: 'boolean', default: false },
name: { type: 'string', short: 'n' },
```

Update return:

```typescript
forkSession: values['fork-session'] ?? false,
sessionName: values['name'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run`
Expected: PASS

- [ ] **Step 5: Wire session resolution in cli.ts**

In `startCli()`, after provider creation and before app render:

```typescript
import { SessionStore } from '@robota-sdk/agent-sessions';

const sessionStore = new SessionStore();
let resumeSessionId: string | undefined;

if (args.continueMode) {
  // Find most recent session for this cwd
  const sessions = sessionStore.list().filter((s) => s.cwd === cwd);
  if (sessions.length > 0) {
    resumeSessionId = sessions[0].id;
  }
} else if (args.resumeId !== undefined) {
  if (args.resumeId === '') {
    // Empty string = show picker (handled in App.tsx)
    resumeSessionId = '__picker__';
  } else {
    // Find by name or ID
    const sessions = sessionStore.list();
    const match = sessions.find((s) => s.id === args.resumeId || s.name === args.resumeId);
    resumeSessionId = match?.id;
  }
}
```

Pass `sessionStore`, `resumeSessionId`, `forkSession`, `sessionName` to `renderApp()` and App component.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-cli/src/utils/cli-args.ts packages/agent-cli/src/cli.ts
git commit -m "feat(agent-cli): add --fork-session, --name flags + session resolution"
```

---

### Task 5: Create ListPicker component

**Files:**

- Create: `packages/agent-cli/src/ui/ListPicker.tsx`
- Test: `packages/agent-cli/src/ui/__tests__/ListPicker.test.tsx`

- [ ] **Step 1: Write failing test — ListPicker renders items and handles selection**

```typescript
import React from 'react';
import { render } from 'ink-testing-library';
import ListPicker from '../ListPicker.js';

it('renders all items with first selected', () => {
  const items = ['Alpha', 'Beta', 'Gamma'];
  const { lastFrame } = render(
    <ListPicker
      items={items}
      renderItem={(item, isSelected) => <Text>{isSelected ? '> ' : '  '}{item}</Text>}
      onSelect={() => {}}
      onCancel={() => {}}
    />,
  );
  const frame = lastFrame()!;
  expect(frame).toContain('> Alpha');
  expect(frame).toContain('  Beta');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run -t "ListPicker"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ListPicker**

```typescript
import React, { useState } from 'react';
import { Box, useInput } from 'ink';

export interface IListPickerProps<T> {
  items: T[];
  renderItem: (item: T, isSelected: boolean) => React.ReactElement;
  onSelect: (item: T) => void;
  onCancel: () => void;
}

export default function ListPicker<T>({
  items,
  renderItem,
  onSelect,
  onCancel,
}: IListPickerProps<T>): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (key.return) {
      if (items[selectedIndex]) onSelect(items[selectedIndex]);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <Box key={index}>{renderItem(item, index === selectedIndex)}</Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run -t "ListPicker"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-cli/src/ui/ListPicker.tsx packages/agent-cli/src/ui/__tests__/ListPicker.test.tsx
git commit -m "feat(agent-cli): add generic ListPicker component"
```

---

### Task 6: Add /resume and /rename system commands

**Files:**

- Modify: `packages/agent-sdk/src/commands/system-command.ts`
- Test: `packages/agent-sdk/src/commands/__tests__/system-command.test.ts`

- [ ] **Step 1: Write failing test — resume and rename commands exist**

```typescript
it('resume returns session list in data', async () => {
  const executor = new SystemCommandExecutor();
  const session = createMockSession();
  const result = await executor.execute('resume', session, '');
  expect(result).not.toBeNull();
  expect(result!.data?.triggerResumePicker).toBe(true);
});

it('rename sets session name', async () => {
  const executor = new SystemCommandExecutor();
  const session = createMockSession();
  const result = await executor.execute('rename', session, 'my-session');
  expect(result).not.toBeNull();
  expect(result!.success).toBe(true);
  expect(result!.data?.name).toBe('my-session');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/agent-sdk test -- --run -t "resume returns"`
Expected: FAIL — unknown command

- [ ] **Step 3: Add commands to createSystemCommands()**

```typescript
{
  name: 'resume',
  description: 'Resume a previous session',
  execute: (_session, _args) => ({
    message: 'Opening session picker...',
    success: true,
    data: { triggerResumePicker: true },
  }),
},
{
  name: 'rename',
  description: 'Rename the current session',
  execute: (session, args) => {
    const name = args.trim();
    if (!name) {
      return { message: 'Usage: rename <name>', success: false };
    }
    return {
      message: `Session renamed to "${name}".`,
      success: true,
      data: { name },
    };
  },
},
```

Update the help command text to include resume and rename.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/agent-sdk test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent-sdk/src/commands/system-command.ts
git commit -m "feat(agent-sdk): add resume and rename system commands"
```

---

### Task 7: Integrate session picker and rename in App.tsx

**Files:**

- Modify: `packages/agent-cli/src/ui/App.tsx`
- Modify: `packages/agent-cli/src/ui/StatusBar.tsx`
- Modify: `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts`

- [ ] **Step 1: Add sessionName prop to StatusBar**

In `packages/agent-cli/src/ui/StatusBar.tsx`, add `sessionName?: string` to IProps. Display between mode and model:

```typescript
{sessionName && (
  <>
    {'  |  '}
    <Text color="magenta">{sessionName}</Text>
  </>
)}
```

- [ ] **Step 2: Handle /resume trigger in App.tsx**

When `handleSubmit` detects `sideEffects._triggerResumePicker`, show ListPicker overlay with sessions from SessionStore.list(). On selection, reload the session.

- [ ] **Step 3: Handle /rename in App.tsx**

When `handleSubmit` detects `sideEffects._sessionName`, call `interactiveSession.setName(name)` and update local state.

- [ ] **Step 4: Handle --resume picker mode**

When `resumeSessionId === '__picker__'`, show ListPicker on initial render instead of input area. On selection, initialize InteractiveSession with the selected session.

- [ ] **Step 5: Run full CLI test suite**

Run: `pnpm --filter @robota-sdk/agent-cli test -- --run`
Expected: All tests PASS

- [ ] **Step 6: Manual smoke test**

```bash
pnpm cli:dev                    # start new session, send a message, exit
pnpm cli:dev -- -c              # should resume with previous messages visible
pnpm cli:dev -- -r              # should show session picker
pnpm cli:dev -- --name "test"   # should show name in StatusBar
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent-cli/src/ui/App.tsx packages/agent-cli/src/ui/StatusBar.tsx packages/agent-cli/src/ui/hooks/useInteractiveSession.ts
git commit -m "feat(agent-cli): integrate session picker, rename, and StatusBar name display"
```

---

### Task 8: Build verification and SPEC updates

**Files:**

- Modify: `packages/agent-sessions/docs/SPEC.md`
- Modify: `packages/agent-sdk/docs/SPEC.md`
- Modify: `packages/agent-cli/docs/SPEC.md`

- [ ] **Step 1: Build all packages**

Run: `pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Run all tests**

Run: `pnpm test -- --run`
Expected: All tests pass

- [ ] **Step 3: Update SPEC.md files**

- agent-sessions SPEC: Document ISessionRecord.history field
- agent-sdk SPEC: Document InteractiveSession session restore, getName/setName
- agent-cli SPEC: Document --continue, --resume, --fork-session, --name, /resume, /rename, ListPicker

- [ ] **Step 4: Commit**

```bash
git add packages/agent-sessions/docs/SPEC.md packages/agent-sdk/docs/SPEC.md packages/agent-cli/docs/SPEC.md
git commit -m "docs: update SPECs for session continue/resume"
```

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
