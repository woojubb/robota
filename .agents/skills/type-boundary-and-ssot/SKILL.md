---
name: type-boundary-and-ssot
description: Applies Robota's preferred workflow for trust-boundary validation, strict typing, and owner-based SSOT reuse. Use when adding or reviewing type contracts, boundary parsing, or shared contract ownership.
---

# Type Boundary and SSOT

## Rule Anchor
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "Rules and Skills Boundary"

## Use This Skill When
- Receiving external data from APIs, events, files, user input, or LLM responses.
- Designing or changing shared contracts and exported types.
- Cleaning up duplicated type declarations or alias chains.
- Reviewing whether a change respects trust boundaries and owner-based SSOT.

## Preconditions
- Identify the trust boundary where external data enters.
- Identify the owner package or module for the contract.
- Determine whether the change affects only local types or exported/shared types.

## Execution Steps
1. Locate the boundary where untrusted data enters the system.
2. Keep the boundary input as `unknown` only until validation is complete.
3. Validate once at the boundary and pass typed data inward.
4. Search for an owned contract before introducing a new type.
5. If the concept already exists, import from the owner surface instead of re-declaring it.
6. If the concept is new, define one owner and keep non-owner modules free of same-shape re-declarations.
7. Run the relevant quality checks for the affected scope:
   - lint
   - typecheck
   - duplicate declaration scan if ownership changed
8. Summarize:
   - boundary used
   - owner selected
   - validation path
   - residual duplication or contract risks

## Stop Conditions
- External data is cast into a domain type without validation.
- A non-owner module re-declares an owned contract.
- `any`, `{}`, or unchecked assertions are used to bypass typing.
- The changed scope fails lint or typecheck.

## Checklist
- [ ] Boundary input remains untrusted until validation completes.
- [ ] Validation happens once at the boundary.
- [ ] Domain code receives typed data, not raw external payloads.
- [ ] Contract ownership is explicit and singular.
- [ ] Duplicate declarations and alias-only indirections are reduced, not increased.
- [ ] Affected scope is linted and typechecked.

## Focused Examples
```ts
function isDagDefinition(input: unknown): input is IDagDefinition {
  if (typeof input !== 'object' || input === null) return false;
  const value = input as Record<string, unknown>;
  return typeof value.dagId === 'string';
}
```

```ts
import type { IToolCall, TToolParameters } from '@robota-sdk/agents';
```

```bash
pnpm --filter @robota-sdk/<pkg> lint
pnpm --filter @robota-sdk/<pkg> exec tsc -p tsconfig.json --noEmit
node scripts/ssot-scan-declarations.mjs
```

## Anti-Patterns
- Casting external payloads directly into owned domain types.
- Re-declaring the same contract shape in multiple modules.
- Adding alias-only types that hide the real owner.
- Using `any` or unchecked assertions because the boundary was not modeled properly.

## Related Harness Commands
- Current: package lint, package typecheck, `node scripts/ssot-scan-declarations.mjs`
- Planned: `pnpm harness:scan`
