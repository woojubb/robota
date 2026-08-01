---
title: 'REL-001: Fix wrong export name in root README Quick Start'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: immediate
area: README.md
depends_on: []
---

## Background

`README.md:25` shows:

```typescript
import { query } from '@robota-sdk/agent-framework';
```

The actual export name is `createQuery`. `query` does not exist as a named export.
Any developer who copies this Quick Start snippet gets an immediate runtime error.

Source: pre-release dev audit 2026-05-25 (Gate G1).

## Change Required

`README.md:25` — change `query` to `createQuery`.
Also verify the rest of the Quick Start snippet calls it correctly (`query('...')` → `createQuery({...})`).

## Acceptance Criteria

- `import { query }` does not appear anywhere in `README.md`
- The Quick Start example is end-to-end correct and matches `content/guide/embedding.md`
