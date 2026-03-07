# Sessions Specification

## Scope
- Owns session and chat management behavior for Robota, including multi-session support and independent workspace handling.

## Boundaries
- Does not own provider-specific transport behavior.
- Keeps session lifecycle and workspace behavior explicit within this package.
