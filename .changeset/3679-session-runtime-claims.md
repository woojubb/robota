---
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-interface-execution': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-cli': patch
---

Every `InteractiveSession` claims its record and restores only from the claim's read.

- Breaking: a session store that offers no `claim` is refused when the session is built, and so is
  one given to the in-process subagent runner. `restoreSessionRecordIntoSession` takes the read to
  restore from (a claim's, or a write-only child's of its handed record) and refuses an unverified
  one; it no longer reads the store itself.
- A record a store that seals calls unverified is refused (`SessionAuthorshipRefusedError`,
  `isSessionAuthorshipRefusedError`: fixed text, nothing the record says) unless the new
  `acceptedDigest` option names exactly its bytes. Those bytes are raised to the owner's only once the
  session has restored from them, and never by `--fork-session`, whose new record is the owner's.
  `checkRestoredRecord` judges the record the session actually restores.
- Every save of the session's id carries the claim, and every way the session ends releases it —
  `releaseSessionClaim()` for a host that stops waiting on a shutdown. A pool asked for an id
  something here still holds refuses with the new change-refusal code `still_closing`
  (`SESSION_STILL_CLOSING_MESSAGE`, or the store's words for a record a subagent may still save:
  `claimedSessionMessage`).
- Attach to a fork is no longer offered, and is refused with the reason, while a job in this process
  runs the fork or a child it was handed to may still save it: attaching opens the record as a second
  session, a second writer. Breaking: `ICreateExecutionWorkspaceSnapshotInput.sessionHasWriter` and
  `IResolveExecutionAttachInput.hasWriter` are required, and both read the store's `hasWriter`.
- When something the session cannot verify changes its record on disk, the session stops saving that
  id and starting work on its own, saves its whole state once under a new id as the owner's, and
  says which. A save only the locked keys refused is tried again at the unlock, and a session that
  ends while either refusal stands, or whose copy could not be written, writes that copy as it ends.

What to do: give a session store of your own `claim`; handle `still_closing` where you switch on
`TSessionChangeRefusalCode`.
