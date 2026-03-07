# Migration from @robota-sdk/core and @robota-sdk/tools

Both `@robota-sdk/core` and `@robota-sdk/tools` have been deprecated and consolidated into `@robota-sdk/agents`.

**Deprecated:** December 2024
**Replacement:** `@robota-sdk/agents`

## @robota-sdk/core Migration

**Before (deprecated):**

```typescript
import { Robota } from '@robota-sdk/core';
```

**After (current):**

```typescript
import { Robota } from '@robota-sdk/agents';
```

## @robota-sdk/tools Migration

**Before (deprecated):**

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
```

**After (current):**

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/agents';
// or
import { FunctionTool } from '@robota-sdk/agents';
```

## Key Changes

- Tool providers are now part of the agents package
- Function tools use the same API but are imported from agents
- Tool registry is integrated into the main agent system
- Better error handling and validation

## Install

```bash
npm install @robota-sdk/agents
```

All functionality from both packages has been preserved and enhanced in the agents package with:

- Unified API surface
- Better plugin architecture
- Improved type safety
- Enhanced performance
- Cleaner API design
