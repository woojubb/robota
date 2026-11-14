# Local host authority

## Purpose

Provides Node hosts with the local authority needed to share secure runtime custody without importing a product entry point: the keyring file store, the key holder that is a process's only place for unlocked keys, the artifact sealers built on it, the passphrase rule, the owner-private session directory and control carrier through which a supervised runtime is registered and reached, and the proof that a registered runtime is the daemon serving a workspace. Any product composition root that protects local state composes these; none of them chooses a product path or asks a person for anything.

## Contract

A keyring store reads a regular file, refuses links and foreign ownership where the host can verify ownership, and bounds input before parsing it. A mutation uses a file lock and checks the expected keyring before replacement. The store verifies the result and reports a failure when it cannot confirm the write; a reported failure may still have changed the file.

Supervised-runtime registrations are untrusted discovery metadata. A registration is read only from an owner-private directory and from a regular file the user owns, never through a link. A runtime is controlled only after its recorded process start time proves it alive and the selected generation still matches, and a daemon is named only after an authenticated status exchange reports that it serves the workspace. A registration that is not known dead and whose control cannot be proven refuses discovery instead of being skipped, and two daemons for one workspace refuse as ambiguous.

## Invariants

The key holder offers operations on the keys, never the keys themselves, so every way of locking ends in one place and a lock ends every way of reading, the data keys of writer epochs included. Sealing needs only the public key and works while locked; opening and authorship need the holder unlocked. No sealer error carries plaintext, a key or a path, and a swapped sealing key is never accepted quietly.

The store never logs or reports keyring content. It rejects an observed change to the expected keyring before replacement. A workspace daemon prover holds one authenticated handover at a time, and a failure to close a link permanently faults it.

## Non-goals

The store does not choose product paths, collect a passphrase, unlock a keyring, or decide which process receives owner authority. The composition root owns these decisions. The prover does not authenticate a control link itself: the opener the composition root supplies must authenticate the selected binding before it returns a link.

## Design decisions

From the first unlock in a process the key holder seals to the sealing key that unlock verified, locked or not, even when the repair of the file cannot be written. Before that first unlock a locked writer can only seal to the key the file holds; that is an accepted weakness, caught at the next unlock and visible meanwhile through the fingerprint. An append-only writer reuses one data key per store for a writer epoch because one public-key operation per line was measured too slow to read back; the epoch ends as soon as the verified key is not the one its data key was sealed to, and at every lock, because a writer's data key reads every line sealed under it and so is key material like any other.

The lock can be taken over after its stale bound even if its former holder is still alive. The final ownership and content checks are separate from the filesystem replacement, so a stalled or non-cooperating writer can change the file between them. The store does not provide an atomic compare-and-swap or an unconditional guarantee against restoring an older keyslot. On filesystems without hard links, creation also relies on a separate absence check and replacement.
