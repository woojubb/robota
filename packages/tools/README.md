# @robota-sdk/tools [DEPRECATED]

> ⚠️ **This package is deprecated and no longer maintained.**

## Migration Notice

The `@robota-sdk/tools` package has been consolidated into `@robota-sdk/agents`. All tool functionality has been moved to the agents package with improved architecture and better plugin support.

### Migration Guide

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

## Status

- ❌ **No longer built** - This package is excluded from build processes
- ❌ **No longer published** - Not included in release cycles  
- ❌ **No longer supported** - No bug fixes or updates
- ✅ **Reference only** - Kept for reference and migration purposes

## For New Projects

Use `@robota-sdk/agents` for all tool functionality:

```bash
npm install @robota-sdk/agents
```

## For Existing Projects

Follow the migration guide in the [main documentation](../../docs/guide/) to update your code to use the new agents package.

All tool functionality from this package has been preserved and enhanced in the agents package with:
- Unified API surface
- Better type safety
- Improved tool registry
- Enhanced performance
- Cleaner plugin architecture

### Key Changes

- Tool providers are now part of the agents package
- Function tools use the same API but are imported from agents
- Tool registry is integrated into the main agent system
- Better error handling and validation

---

**Last active version:** 1.0.x  
**Deprecated:** December 2024  
**Replacement:** `@robota-sdk/agents` 