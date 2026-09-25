---
'@robota-sdk/agent-interface-transport': minor
'@robota-sdk/agent-transport': minor
---

Access-token verification for a remote resource server.

`agent-interface-transport` gains the contract: `IAccessTokenVerifier`, its configuration
`IAccessTokenVerifierConfig`, and the verdict `TAccessTokenAdmission` — admitted, or refused with one
`TAccessTokenRefusal` reason. A verdict never carries the token or a claim value.

`agent-transport/node` gains `createAccessTokenVerifier`, built on `jose` (now a direct, pinned
dependency). A token is admitted only when it is an `at+jwt` access token within a length bound,
issued by exactly the configured issuer, signed with a configured RS256, ES256 or EdDSA key whose
type, curve, `alg` and `use` agree with it, within `exp`/`nbf` with 60 s of skew, addressed to the
configured resource, carrying the required scopes, and from an allowlisted subject or client. The
host is single-tenant, so a configuration without an allowlist is refused at construction.

Keys are discovered through the issuer's metadata (RFC 8414, then OpenID discovery, with an issuer
equality check) and fetched over `https` through agent-core's egress boundary, byte-bounded, with
private-address reach granted to the issuer's host only. The key set is cached and refetched, at a
bounded rate, for an unknown `kid` or once it reaches a maximum age, so a key the issuer withdraws
stops admitting; keys are trusted only up to a bounded age, and beyond that an outage refuses.

Nothing is wired to a listener yet.
