---
name: robota-sdk-usage
description: Guide Robota SDK usage patterns, constructor configuration, and migration from deprecated packages. Use when working on Robota setup, constructor options, or SDK migration.
---

# Robota SDK Usage

## Rule Anchor
- `AGENTS.md` > "Rules and Skills Boundary"
- `AGENTS.md` > "Development Patterns"

## Scope
Use this skill when configuring Robota instances, creating tools, or migrating from deprecated packages.

## Preconditions
- The project uses `@robota-sdk/agents` as the primary SDK package.

## Current Constructor Pattern
Use an array for providers, and place `systemMessage` under `defaultModel`.

```typescript
import { Robota } from '@robota-sdk/agents';

const robota = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'You are helpful.'
  },
  tools: [tool1, tool2]
});
```

## Avoid These Patterns
- `aiProviders: { openai: provider }` (object format)
- `currentProvider: 'openai'`
- `systemPrompt: 'message'` (use `defaultModel.systemMessage`)
- `toolProviders: [provider]`

## Package Migration
- `@robota-sdk/core` → `@robota-sdk/agents`
- `@robota-sdk/tools` → `@robota-sdk/agents`

## Sessions Package Warning
The sessions package is experimental and incomplete. Use `@robota-sdk/agents` directly.

## Tool Creation Pattern
```typescript
import { createZodFunctionTool } from '@robota-sdk/agents';

const tool = createZodFunctionTool(
  'toolName',
  'Description',
  zodSchema,
  async (params) => { /* implementation */ }
);
```

## Deprecated Tool Pattern
- `createZodFunctionToolProvider` (use `createZodFunctionTool`)

## Examples Operations
- Keep a single CLI entrypoint for scenario execution.
- Maintain package-level example indexes under `examples/INDEX.md`.
- Ensure example documentation reflects current file names and paths.

## Checklist
- [ ] `aiProviders` is an array.
- [ ] `defaultModel.systemMessage` is used.
- [ ] `tools` is an array.
- [ ] Imports use `@robota-sdk/agents`.
- [ ] No deprecated properties or packages.
