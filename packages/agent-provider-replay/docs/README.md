# agent-provider-replay Docs Index

- `SPEC.md`: Session-log replay provider scope, contract, and package boundary.

Both source factories and direct construction validate the complete versioned log before selecting
responses. Invalid events raise the session-owned `SessionLogDecodeError` instead of being skipped.
External payloads require explicit read authority and retain their integrity/budget checks.
