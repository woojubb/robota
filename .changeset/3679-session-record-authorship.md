---
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
---

Session stores claim the sessions a process runs, and a store that seals says whose each record is.

- Breaking: `IInteractiveSessionStore.claim(id, { fresh })` and `hasWriter(id)` are required.
  `claim` reads the record as the hold read a running session restores from and claims the id; a
  second claim, or a claim of a record handed to a subagent process that may still save it, throws
  `SessionClaimedError` (`isSessionClaimedError`, from `@robota-sdk/agent-session`; reasons
  `claimed`, `released`, `exported`), and a save of a claimed id must carry its live claim
  (`ISessionSaveOptions.claim`), so a one-off save of a running session's id (a rename or a handoff
  receive from elsewhere) is refused. `hasWriter` says whether a claim or such an export stands for
  the id. `NodeSessionStore` and the project store claim whether or not they seal.
- A store that seals tags what an unlocked process writes with an authorship tag only the unlocked
  keys make, and every `valid` outcome carries `authorship: 'verified' | 'unverified'`, the `digest`
  of the stored bytes, and `diverged: true` for a running session's id whose file something
  unverifiable changed. Its sealing-only operations are one member, `authorship?: ISessionAuthorship`
  (`adopt`, `heldDigest`, `exportEnded`, `onUnlock`), absent from a store that never seals; `adopt`
  raises exactly the bytes with that digest and never a record handed to a process that may still
  save it (`'adopted' | 'pending' | 'changed' | 'exported'`). The token `exportHeld` hands a child
  says whether the store held the record as the owner's, and the child reads it as verified only then.
- New: `ISessionSaveOptions.provenance`, `ISessionExportOptions.handoffOnly`,
  `IResumableSessionSummary.authorship`. `StoredSessionRecords` reaches a store's files through one
  adapter, `IStoredSessionFiles`, and keeps its bookkeeping internal. `decorateSessionStore`
  (`@robota-sdk/agent-framework`) wraps a store without dropping a member.

What to do: a session store of your own implements `claim` and `hasWriter`. A store that keeps its
records plain writes no authorship and has no `authorship` member.
