# A scripted edit that rebuilds a region destroys what else was in that region

There are two shapes of scripted edit and only one of them is safe. **Substituting within a region**
replaces a token and leaves everything around it. **Reconstructing a region** — building the new text
from a template of what that region "should" contain — writes over whatever else happened to live
there. A sweep that only substitutes a token cannot do this; a sweep that rebuilds always can.

The failure is silent by construction, because a reconstructed region is well-formed. The file still
parses. The type checker is often satisfied. What is gone is content the template did not know about.

## The two instances that name the mechanism

**A rebuilt import block deletes an unrelated import.** Resolving a conflict where a package moved,
a script rewrote each conflicted import block into a single import from the new package. Four test
files also imported a local helper inside that region. The helper imports vanished; the call sites
stayed. The files parse, the type checker (which does not read these test files — issue #2192) said
nothing, and the suite failed at runtime with `loadedOrMissing is not defined`.

**A rebuilt object literal cannot tell a fixture from an assertion.** A rewrite across test files
sees literals with the same keys on both sides of the equation. Only the file's ROLE says which is
the input and which is the claim:

```ts
messages: [{ role: 'user', content: 'previous' }]; // fixture — must satisfy the contract
expect.objectContaining({ role: 'user', content: 'previous' }); // assertion — is what the test claims
```

Patching the fixture is the repair. Patching the assertion **changes what the test asserts**, and it
always produces green. It is an accidental green reached from a different direction: the suite passes
and has stopped checking the thing it named.

## The rule

- **Prefer substitution to reconstruction.** If a script must rebuild a region, it must preserve
  every line it did not come to change — which means reading them, not templating over them.
- **After any script edits N files, read the DELETED lines**: `git diff -U0 | grep '^-'`. An
  over-application is invisible in the added lines and obvious in the removed ones. This is the
  cheapest check and it catches both instances above.
- **A sweep may edit fixtures OR assertions in one pass, never both.**
- **A suite that goes green immediately after a sweep touched assertion lines has proved nothing**
  until the sweep's diff over those lines is read by hand.

## Where this came from

Four over-applications in one day, all from scripted rewrites during the session-record codec work
(TRANS-005 / TRANS-006 / TRANS-007):

1. `store.list()` on an unrelated `memoryStore` rewritten to a session-store helper.
2. Mock-session history literals given members their local type does not declare.
3. `expect.objectContaining({ role, content })` rewritten to include `id: 'm-9'` while the fixture
   carried `m-7` — the assertion was made to match a fixture that did not exist.
4. A rebuilt import block deleting the local helper import from four files at once.

The first two failed loudly (type errors). The third would have passed had the ids happened to line
up. The fourth failed at runtime only, and only in a package whose test files nothing typechecks.
**The loudness of the failure is unrelated to the severity of the edit** — it is decided by which
tool happens to read that region.

## Related

- The contract-cast ratchet governs which contracts a test may cast past — issue #2190.
- Test files excluded from a package's typecheck get none of the loud failures above — issue #2192.
- `.agents/rules/enforcement-architecture.md` — silence is not success; a green that stopped checking
  is the same defect as a check that never ran.
