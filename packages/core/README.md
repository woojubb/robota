# @robota-sdk/core [DEPRECATED]

> ⚠️ **This package is deprecated and no longer maintained.**

## Migration Notice

The `@robota-sdk/core` package has been consolidated into `@robota-sdk/agents`. All functionality has been moved to the agents package with improved architecture and better plugin support.

### Migration Guide

**Before (deprecated):**
```typescript
import { Robota } from '@robota-sdk/core';
```

**After (current):**
```typescript
import { Robota } from '@robota-sdk/agents';
```

## Status

- ❌ **No longer built** - This package is excluded from build processes
- ❌ **No longer published** - Not included in release cycles  
- ❌ **No longer supported** - No bug fixes or updates
- ✅ **Reference only** - Kept for reference and migration purposes

## For New Projects

Use `@robota-sdk/agents` instead:

```bash
npm install @robota-sdk/agents
```

## For Existing Projects

Follow the migration guide in the [main documentation](../../docs/guide/) to update your code to use the new agents package.

All functionality from core has been preserved and enhanced in the agents package with:
- Better plugin architecture
- Improved type safety
- Enhanced performance
- Cleaner API design

---

**Last active version:** 1.0.x  
**Deprecated:** December 2024  
**Replacement:** `@robota-sdk/agents` 