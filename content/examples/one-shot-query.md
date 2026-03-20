# One-Shot Query

The simplest way to use Robota SDK programmatically.

```typescript
import { query } from '@robota-sdk/agent-sdk';

// Basic — uses default config from .robota/settings.json
const response = await query('What files are in this project?');
console.log(response);
```

## With Options

```typescript
const response = await query('Refactor the error handling in src/utils.ts', {
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 5,
  onTextDelta: (delta) => process.stdout.write(delta),
});
```

## In Scripts

```typescript
#!/usr/bin/env tsx
import { query } from '@robota-sdk/agent-sdk';

const task = process.argv[2];
if (!task) {
  console.error('Usage: script.ts "task description"');
  process.exit(1);
}

const response = await query(task, {
  permissionMode: 'bypassPermissions',
  maxTurns: 20,
});

console.log(response);
```

`query()` handles config loading, context discovery, session creation, and cleanup automatically. For multi-turn conversations, use `createSession()` instead.
