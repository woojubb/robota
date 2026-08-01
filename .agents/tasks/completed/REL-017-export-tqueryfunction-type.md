---
title: 'REL-017: Export TQueryFunction type alias from agent-framework'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: medium
urgency: before-stable
area: packages/agent-framework/src/query.ts, packages/agent-framework/src/index.ts
depends_on: []
---

## Background

`createQuery()` returns `(prompt: string) => Promise<string>`. This is a correct but
anonymous function type. External consumers cannot annotate their own code with the
return type of `createQuery`.

Example gap:

```typescript
// External developer wants to type this:
let myAgent: ???; // Cannot reference the return type of createQuery

myAgent = createQuery({ provider });
```

This is a minor but noticeable quality-of-life gap for TypeScript consumers.

Source: pre-release dev audit §4 minor (2026-05-25).

## Change Required

In `packages/agent-framework/src/query.ts`:

```typescript
/** Type of the function returned by createQuery(). */
export type TQueryFunction = (prompt: string) => Promise<string>;
```

Export from `packages/agent-framework/src/index.ts`:

```typescript
export type { TQueryFunction } from './query.js';
```

## Acceptance Criteria

- `import type { TQueryFunction } from '@robota-sdk/agent-framework'` resolves without error
- `TQueryFunction` appears in the generated `.d.ts` for `agent-framework`
