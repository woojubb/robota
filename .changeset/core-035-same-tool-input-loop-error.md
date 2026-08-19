---
'@robota-sdk/agent-core': patch
---

CORE-035: the identical-tool-input loop guard throws a named error, and the SPEC now matches it

The SPEC documented an `AbortError` thrown at the Nth identical call. The code threw a bare `Error`
at the N+1th. The type difference was behavioral, not cosmetic: `isAbortFailure` resolves an
`AbortError` as `success: true, interrupted: true`, so a run that detected a pathological loop and
produced no answer would have been reported as a SUCCESS.

Resolved toward the code's semantics and the SPEC's intent, which are not the same thing:

- **Failure, not abort.** A guard trip is the agent giving up, not the user cancelling. `AbortError`
  means the caller asked the turn to stop, and here nobody did.
- **Named, not bare.** `SameToolInputLoopError` (`code: 'SAME_TOOL_INPUT_LOOP'`, `category: 'system'`,
  `recoverable: true`) carries `toolName`, `callCount` and `maxSameToolInputs`. Naming a type is what
  the SPEC was reaching for: a caller must be able to tell "the agent looped" from "the network died",
  and CORE-027 carries those fields out intact.
- **`maxSameToolInputs` is a MAXIMUM.** The Nth identical call is allowed; the N+1th trips. The SPEC's
  "N or more times" contradicted its own option name.

`ErrorUtils` moves to `utils/error-utils.ts`, split from the class taxonomy it operates on — two
responsibilities in one file, and keeping them together made the taxonomy file impossible to extend.
Both remain exported from the package entry.
