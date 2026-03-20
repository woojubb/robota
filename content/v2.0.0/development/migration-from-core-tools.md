# Migration from @robota-sdk/core and @robota-sdk/agent-tools

Both `@robota-sdk/core` and `@robota-sdk/agent-tools` have been deprecated and consolidated into `@robota-sdk/agent-core`.

**Deprecated:** December 2024
**Replacement:** `@robota-sdk/agent-core`

## @robota-sdk/core Migration

**Before (deprecated):**

```typescript
import { Robota } from '@robota-sdk/core';
```

**After (current):**

```typescript
import { Robota } from '@robota-sdk/agent-core';
```

## @robota-sdk/agent-tools Migration

**Before (deprecated):**

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/agent-tools';
```

**After (current):**

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/agent-core';
// or
import { FunctionTool } from '@robota-sdk/agent-core';
```

## Key Changes

- Tool providers are now part of the agents package
- Function tools use the same API but are imported from agents
- Tool registry is integrated into the main agent system
- Better error handling and validation

## Install

```bash
npm install @robota-sdk/agent-core
```

All functionality from both packages has been preserved and enhanced in the agents package with:

- Unified API surface
- Better plugin architecture
- Improved type safety
- Enhanced performance
- Cleaner API design
