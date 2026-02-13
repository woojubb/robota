---
name: import-standards
description: Provide static import patterns, examples, and review checks. Use when discussing import rules, module loading patterns, or ES module setup.
---

# Import Standards

## Rule Anchor
- `.cursor/rules/development-architecture-rules.mdc`

## Scope
Use this skill to apply preferred import patterns and review checklists.

## Preferred Patterns
```typescript
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

## Review Checklist
- [ ] Imports are top-level and static.
- [ ] Required modules are imported once.
- [ ] ES module `__dirname` pattern is correct.
- [ ] No dynamic import in function bodies.
