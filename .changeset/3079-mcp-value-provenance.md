---
'@robota-sdk/agent-mcp': minor
---

MCP definitions now record where each materialized value came from. One principle, read from
that record, decides what is secret, and the fingerprint and every printed value use it.

- **Provenance:** `materializeDefinition` records, for every expanded field, the stretches each
  variable produced, and whether that variable is credential-shaped (`provenance`).
  - A credential-shaped variable is matched by whole name segments, case-insensitively: `TOKEN`,
    `SECRET`, `PASSWORD`, `KEY`, `AUTH`, `PAT`, `COOKIE`, `DSN`, `DATABASE_URL`, and similar.
  - A value under a credential-shaped env or header key is secret as a whole.
- **Fingerprint:** it now covers env and header **values** too, with each secret replaced by a
  marker naming its source.
  - A changed `NODE_OPTIONS` value, a changed host around a token, or a changed non-secret
    variable now invalidates an approval on every transport.
  - Rotating a credential still does not.
  - The fingerprint is versioned, so approvals recorded before this change are asked for again
    once. The default approval store is in memory.
- **Printed values:**
  - The activation endpoint and a projected URL show their secret stretches as `secret:VAR`.
  - A refused redirect's error names origins only.
  - Stdio command, args and cwd projections stay redacted wholesale.
- **New contracts:**
  - `IMCPValueSpan`, `TMCPValueProvenance`, and `IMCPServerDefinitionResolved.provenance`.
  - `isCredentialShapedName`, `withoutSecrets`, `secretMarker`, `SECRET_LITERAL`.
  - `activationEndpoint`.
