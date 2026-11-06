# Local host authority

## Purpose

Provides Node hosts with the local file authority needed to share secure runtime custody without importing a product entry point.

## Contract

A keyring store reads a regular file, refuses links and foreign ownership where the host can verify ownership, and bounds input before parsing it. A mutation is serialized and committed only against the exact keyring it was based on. A successful write is durable and verified; a write that may already have committed reports that uncertainty to its caller.

## Invariants

The store never logs or reports keyring content. A lock cannot be reused after it is lost, and a stale caller cannot restore an older keyslot over a newer file.

## Non-goals

The store does not choose product paths, collect a passphrase, unlock a keyring, or decide which process receives owner authority. The composition root owns these decisions.
