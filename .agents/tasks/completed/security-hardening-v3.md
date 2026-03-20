# Security Hardening for release/v3.0.0

## Status: done

## Checklist

- [x] P0: Stored XSS via Content-Type — allowlist + sanitizeFileName
- [x] P1: Missing security headers — helmet middleware
- [x] P2: Content-Disposition header injection — covered by P0 sanitizeFileName
- [x] P3: Webhook URL scheme restriction — http/https only
- [x] Tests: route-utils unit tests (14 tests)
- [x] Tests: webhook-plugin URL scheme validation (4 tests added)
- [x] Build verification: dag-server-core + agents pass
- [x] Typecheck pass (dag-server-core clean, agents has pre-existing errors)
