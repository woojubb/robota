# One-Shot Query

The simplest way to use Robota SDK programmatically.

```typescript
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const query = createQuery({ provider });

const response = await query('What files are in this project?');
console.log(response);
```

## With Options

```typescript
const query = createQuery({
  provider,
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 5,
});

const response = await query('Refactor the error handling in src/utils.ts');
```

## In Scripts

```typescript
#!/usr/bin/env tsx
import { createQuery } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const query = createQuery({ provider, permissionMode: 'bypassPermissions', maxTurns: 20 });

const task = process.argv[2];
if (!task) {
  console.error('Usage: script.ts "task description"');
  process.exit(1);
}

const response = await query(task);
console.log(response);
```

`createQuery()` returns a reusable function pre-configured with a provider. It handles config loading, context discovery, session creation, and cleanup automatically. For multi-turn conversations, use `InteractiveSession` instead.
