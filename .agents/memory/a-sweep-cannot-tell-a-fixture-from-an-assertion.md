# A sweep over tests cannot tell a fixture from an assertion

A regex or scripted rewrite across test files sees object literals with the same keys on both sides
of the equation. Only the file's ROLE in the test says which is the input and which is the claim:

```ts
messages: [{ role: 'user', content: 'previous' }]; // fixture — must satisfy the contract
expect.objectContaining({ role: 'user', content: 'previous' }); // assertion — is what the test claims
```

Patching the fixture is the repair. Patching the assertion **changes what the test asserts**, and it
always produces green, so the failure mode is silent by construction. It is an accidental green
reached from a different direction: the suite passes and has stopped checking the thing it named.

## The rule

- **A sweep may edit fixtures OR assertions in one pass, never both.**
- **A suite that goes green immediately after a sweep touched assertion lines has proved nothing**
  until the sweep's diff over those lines is read by hand.
- The cheapest check is `git diff` filtered to assertion helpers — `expect(`, `toEqual`,
  `objectContaining`, `toHaveBeenCalledWith` — before trusting the run.

## Where this came from

Three over-applications in one day, all from scripted rewrites during the session-record codec work
(TRANS-005 / TRANS-006 / TRANS-007):

1. `store.list()` on an unrelated `memoryStore` rewritten to a session-store helper.
2. Mock-session history literals given members their local type does not declare.
3. `expect.objectContaining({ role, content })` rewritten to include `id: 'm-9'` while the fixture
   carried `m-7` — the assertion was made to match a fixture that did not exist.

The first two failed loudly (type errors). **The third would have passed** had the ids happened to
line up, and it is the one this note exists for.

## Related

- The contract-cast ratchet governs which contracts a test may cast past — issue #2190.
- Test files excluded from a package's typecheck get none of the loud failures above — issue #2192.
- `.agents/rules/enforcement-architecture.md` — silence is not success; a green that stopped checking
  is the same defect as a check that never ran.
