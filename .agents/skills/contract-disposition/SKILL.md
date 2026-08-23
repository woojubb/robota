---
name: contract-disposition
description: Decide what to do with an unconsumed or seemingly-immovable public contract — WITHOUT reading its state from a proxy signal. "grep found no consumer" is not "dead", and "it is published" is not "we cannot change it". Verify the actual state, then choose from a closed disposition vocabulary. Use before removing, deprecating, or declining to change any exported surface, contract field, or option. Distinct from the `contract-audit` skill, which is about a package's SPEC.md Class Contract Registry.
---

# Contract Disposition

Two mirror-image errors, one substitution. Both were made in a single session, and both were acted on
by the agent that made them.

| Proxy signal read         | Conclusion drawn          | What was actually true                                                                |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| `grep` finds no consumer  | "dead — remove it"        | forward-provisioned, or the owner is wrong → **relocate**                             |
| `grep` finds one consumer | "make it package-private" | a library surface with one in-repo assembly; its other consumers are outside the repo |
| the surface is published  | "we cannot change this"   | pre-release; **nothing is externally exposed**                                        |

## Rule Anchor

- [project-structure.md](../../project-structure.md) § Forward-Provisioned Surface Rule (`:236`) —
  "Removal or narrowing of a public surface is a PRODUCT decision — never a grep-based cleanup."
  **This rule already existed and was violated anyway**, which is why this skill is a procedure plus a
  mechanism rather than a restatement. That section also owns the broader form: **in-repo consumer
  count is not evidence about whether a surface should be public, at any count** — the only grounds for
  narrowing or removing one are that it is genuinely unnecessary or that it does not fit the design
  (owner decision, 2026-08-23).
- [code-quality.md](../../rules/code-quality.md) `:50`–`:51` — pre-release, legacy is disposable and
  there is no backward-compat constraint to preserve a lesser structure.

## The exposure gate — mandatory, and it comes first

**Before any "we cannot change this" judgement, verify the actual current exposure state.** Not the
intuition that a surface feels public; the state.

For a package in this repository that is checkable in one command:

```bash
curl -s https://registry.npmjs.org/<pkg> | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['dist-tags']); print('non-prerelease:', [v for v in d['versions'] if not any(x in v for x in ('beta','rc','alpha','next','canary'))])"
```

An empty non-prerelease list means **no consumer holds a compatibility claim**, and any argument of
the form "we cannot change this because it is published" is unavailable. Say so with the number
rather than asserting the conclusion.

This gate applies in both directions. It is equally wrong to assume a surface is safe to break because
"it's beta" without checking whether something in-repo depends on it.

## The closed disposition vocabulary

An unconsumed public contract has exactly three correct dispositions. "Delete because grep found
nothing" is not among them:

1. **Keep + document** as intentional forward provision. Forward-provisioned surfaces carry the same
   quality bar as consumed ones — accurate SPEC/README, tests, and bug fixes are unconditional.
2. **Relocate** if the owner is wrong. The surface is real; it is in the wrong place.
3. **Remove or narrow**, only by an explicit product decision, proposed as a user decision item with
   options — and only on one of the two grounds that qualify: the surface is genuinely unnecessary, or
   it does not fit the design. A consumer count is never one of them; it is at most what made you look.

## What a consumer COUNT does not tell you

The heading below says "unconsumed" because zero is the count that gets misread most often. **The
reasoning applies at every count**, and one is the second-most-misread: a library surface used by a
single in-repo assembly is the normal shape for a library whose other consumers compose it from
outside. `packages/` exists so that anyone can build their own agent from it; this repository's own
agent is one assembly of it, not the definition of it.

- **A consumer may exist that grep cannot see** — a re-export chain, a string-keyed dispatch, a
  published-package consumer outside this repo, a test.
- **Carried-but-not-honored is not dead.** A field that is threaded through and then ignored has a
  live producer and a missing consumer; the fix is to honor it, and there is usually a filed item that
  does. Labelling it "dead" hides that item.
- **Zero consumers is the expected state of a deliberately forward-provisioned surface.** Frameworks
  ship surfaces for external consumers.

## Procedure

1. **Run the exposure gate** and record the number.
2. **Establish the consumer set** — beyond grep: re-exports, dynamic dispatch, tests, docs, and
   whether a filed item exists that would consume it.
3. **Choose a disposition** from the closed vocabulary, and state which.
4. **If the disposition is Remove**, propose it as a decision item with options. Do not file it as
   "dead code", and do not describe it as dead in a commit body or changeset.

## Anti-Patterns

- "No usages found, removing" — a grep result presented as a product decision.
- "Dead contract field" in a changeset, when the field is carried-but-not-honored.
- "We can't change this, it's published" with no version check.
- Deciding the disposition and applying it in the same breath, with nothing independent between.
