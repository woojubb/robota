---
'@robota-sdk/agent-interface-transport': major
'@robota-sdk/agent-framework': major
---

**BREAKING — ARCH-012: three `IInteractiveSession` members become required, and the conformant test double moves.**

`isInitialized`, `getPendingCount` and `getActiveDriverId` were OPTIONAL. A consumer reading
`session.getActiveDriverId?.() ?? undefined` received the same `undefined` for two unrelated
situations — the host attributes turns and none is active, and the host cannot attribute turns at all
— with no error, no log, and nothing to tell them apart. The second loses every co-drive attribution
silently.

**Any implementation of `IInteractiveSession` must now provide all three.** `null` from
`getActiveDriverId()` means exactly one thing: nobody is driving.

```ts
// before — a host could simply omit these
class MySession implements IInteractiveSession {
  submit(/* … */) {
    /* … */
  }
}

// after
class MySession implements IInteractiveSession {
  readonly isInitialized = true;
  getPendingCount(): number {
    return this.queue.length;
  }
  getActiveDriverId(): TDriverId | null {
    return this.activeDriver ?? null;
  }
  submit(/* … */) {
    /* … */
  }
}
```

**`createTestInteractiveSession` moved** from `@robota-sdk/agent-framework` (its `./testing` subpath)
to `@robota-sdk/agent-interface-transport/testing`, beside the contract it doubles. It is **not**
re-exported from the old location: pass-through re-exports of another package's symbols are banned in
this repo, and the old export had no in-repo consumers — every transport package sits below
`agent-framework` and could never import it, which is why 41 hand-rolled partials existed instead.

```ts
// before
import { createTestInteractiveSession } from '@robota-sdk/agent-framework/testing';
// after
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
```
