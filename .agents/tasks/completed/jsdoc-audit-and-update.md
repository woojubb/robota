# JSDoc Audit and Update

## Status: completed

## Priority: high

## Context

JSDoc comments feed into the documentation build pipeline (`pnpm docs:build`).
After extensive refactoring (code review fixes, type renames, contract changes),
JSDoc is likely out of sync with current SPEC.md and actual code behavior.

## Core Principle: SPEC.md is the Contract SSOT

SPEC.md defines the authoritative contract for each package:
- What the package owns (scope, type ownership)
- How it relates to other packages (boundaries, dependencies)
- What contracts it implements or exposes (interfaces, extension points)

**JSDoc must be derived from SPEC.md, not the other way around.**

### Workflow per symbol

1. **Read SPEC.md** — understand the package's scope, boundaries, type ownership, and contract registry
2. **Verify contract alignment** — does this class/function/interface fulfill the role described in SPEC.md?
3. **Write JSDoc** — describe the symbol's responsibility consistent with SPEC.md's contract definitions
4. **Cross-check relationships** — if SPEC.md says class A implements interface B from package C, JSDoc on A must reference that contract relationship
5. **Flag drift** — if code contradicts SPEC.md, fix the code or update SPEC.md first, then write JSDoc

### Contract consistency rules

- If SPEC.md Type Ownership says type `T` is owned by package `P`, JSDoc on `T` in `P` must say "Owned by this package" and JSDoc on re-exports/consumers must say "Defined in `P`"
- If SPEC.md Class Contract Registry says class `C` implements `I`, JSDoc on `C` must reference `I` and its contract source
- If SPEC.md Extension Points lists interface `I` as consumer-implemented, JSDoc on `I` must describe the extension contract
- If SPEC.md Boundaries says "does not own X", JSDoc must not describe the symbol as owning X
- Cross-package dependencies described in SPEC.md must be reflected in JSDoc `@see` references

### What JSDoc must express

| Element | JSDoc must describe |
|---------|-------------------|
| Class | Role per SPEC.md, which contracts it implements, ownership scope |
| Interface | Whether it's a contract boundary or extension point, owning package |
| Function | What contract it fulfills, preconditions, postconditions |
| Type alias | Semantic meaning, owning package if SSOT |
| Constant | Domain meaning, which event/error taxonomy it belongs to |

## Goals

1. SPEC.md is read first, JSDoc is derived from it — never the reverse
2. Every JSDoc accurately reflects the contract relationships in SPEC.md
3. Consistent style and vocabulary across all packages
4. Every exported class, function, interface, and type alias has a JSDoc comment
5. Remove stale/misleading JSDoc from refactored code

## Scope

All `packages/*/src/` exported symbols.

## Style Rules

- Use `@param`, `@returns`, `@throws`, `@example` tags consistently
- Do not duplicate type information already expressed by TypeScript signatures
- Keep descriptions concise (1-2 sentences for most items)
- Use `@see` to reference related contracts, SPEC.md sections, or cross-package types
- Use `@internal` for non-public exports
- Use `@deprecated` with migration guidance when applicable
- Korean prohibited in JSDoc (English only per AGENTS.md)
- Vocabulary must match SPEC.md terminology (e.g., if SPEC says "orchestrator" don't use "coordinator" in JSDoc)

## Audit Checklist

### Phase 0: SPEC.md pre-check
- [ ] All packages have up-to-date SPEC.md (prerequisite: spec-content-enrichment task)
- [ ] Class Contract Registry sections are complete
- [ ] Type Ownership tables are accurate

### Phase 1: Core packages
- [ ] agents — exported classes, services, interfaces
- [ ] openai — provider, types
- [ ] anthropic — provider, types
- [ ] google — provider, types

### Phase 2: Infrastructure packages
- [ ] sessions — SessionManager, ChatInstance
- [ ] team — relay-assign-task, templates
- [ ] remote — client, server, transport, transformers

### Phase 3: DAG packages
- [ ] dag-core — domain types, services, validators
- [ ] dag-runtime — orchestrator, services
- [ ] dag-worker — worker loop, services
- [ ] dag-scheduler — trigger service
- [ ] dag-projection — read model service
- [ ] dag-api — controllers, composition
- [ ] dag-designer — components, contracts
- [ ] dag-nodes — node implementations

### Phase 4: Cross-package verification
- [ ] Contract references between packages are consistent (A's JSDoc about B matches B's SPEC.md)
- [ ] Type ownership claims in JSDoc match SPEC.md Type Ownership tables
- [ ] `pnpm docs:build` succeeds and produces correct documentation
- [ ] No JSDoc contradicts SPEC.md

## Acceptance Criteria

- Every exported symbol has a JSDoc comment derived from SPEC.md
- JSDoc accurately reflects contract relationships (implements, extends, consumes)
- Cross-package references are consistent in both directions
- `pnpm docs:build` produces correct documentation
- No Korean text in JSDoc
- No terminology drift between SPEC.md and JSDoc
