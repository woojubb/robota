# Local host authority

## Purpose

Provides Node hosts with the local file authority needed to share secure runtime custody without importing a product entry point.

## Contract

A keyring store reads a regular file, refuses links and foreign ownership where the host can verify ownership, and bounds input before parsing it. A mutation uses a file lock and checks the expected keyring before replacement. The store verifies the result and reports a failure when it cannot confirm the write; a reported failure may still have changed the file.

## Invariants

The store never logs or reports keyring content. It rejects an observed change to the expected keyring before replacement.

## Non-goals

The store does not choose product paths, collect a passphrase, unlock a keyring, or decide which process receives owner authority. The composition root owns these decisions.

## Design decisions

The lock can be taken over after its stale bound even if its former holder is still alive. The final ownership and content checks are separate from the filesystem replacement, so a stalled or non-cooperating writer can change the file between them. The store does not provide an atomic compare-and-swap or an unconditional guarantee against restoring an older keyslot. On filesystems without hard links, creation also relies on a separate absence check and replacement.
