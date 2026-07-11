# REMOTE-012 — Stage E3: TOFU trusted-device reconnect

Spec: `.agents/spec-docs/active/REMOTE-012-stage-e3-tofu-trusted-device-reconnect.md`

Parent: REMOTE-001 (Stage E). GATE-APPROVAL: proposal-reviewer ENDORSE (2 rounds — mutual reconnect auth
added in round 2). Optional hardening applied: embed `deviceId ‖ hostIdentityId` in the signed transcript.

## Tasks

- [ ] T1 (TC-01/02): `agent-remote-pairing/src/device-identity.ts` — `generateIdentityKeyPair(extractable)`, `exportPublicKey`/`importPublicKey` (SPKI base64url), `deriveIdentityId` (SHA-256(SPKI)), `signChallenge`/`verifyChallenge` over `deviceId ‖ hostIdentityId ‖ nonceHost ‖ nonceDevice ‖ sortedPair(fp)`. Isomorphic WebCrypto only. Unit tests: round-trip + negatives.
- [ ] T2 (TC-03): `agent-remote-pairing/src/reconnect.ts` — mutual controller: frames rc-hello/rc-host/rc-device; each verifies the counterpart against its pinned key before accept; fail-closed on timeout/bad-sig/rogue-host/unknown. Unit test mirrors handshake.test.ts.
- [ ] T3: `agent-remote-pairing/src/index.ts` exports + `docs/SPEC.md`.
- [ ] T4 (TC-04): `agent-cli/src/remote-control/host-identity.ts` — load-or-create host ECDSA identity keypair as a 0600 JWK under ~/.robota; reload across restarts. Unit test.
- [ ] T5 (TC-04): `agent-cli/src/remote-control/trusted-device-store.ts` — JSON store under ~/.robota keyed by deviceId ({publicKey,label,createdAt,lastSeenAt}); list/get/upsert/revoke; fail-fast on corrupt (SettingsParseError precedent); public keys only. Unit test incl. no-private-material assertion.
- [ ] T6 (TC-05/08): wire into `remote-control-controller.ts` + `index.ts` — `IRemoteControlControllerDeps.trustedDeviceStore` + `hostIdentity` seams; enroll-on-accept; reconnect lookup; `/remote-control devices` + `revoke <id>` verbs.
- [ ] T7 (TC-05/07): `agent-transport-webrtc` — `pairing-gate.ts` thread `IPairingResult` into `onAccept(result)`; first-pair identity-key exchange over confirmed channel; reconnect branch runs mutual `reconnect.ts`; `webrtc-transport.ts` `onPaired(enrollment)`. Extend pairing-gate + pairing-e2e tests (rogue-host, MITM-fp, proof-replay).
- [ ] T8 (TC-06): `agent-web-ui/src/client/device-credential-store.ts` — IndexedDB keyed by relayOrigin+hostIdentityId; non-extractable device keypair + pinned host key; never serialize private key. `rtc-responder-gate.ts`/`rtc-session-client.ts` enroll+pin first pair, verify host on reconnect. Unit test (fake IndexedDB).
- [ ] T9: `agent-transport-webrtc/docs/SPEC.md` + public-surface updates across packages (spec-public-surface scan).
- [ ] T10 (TC-08): `pnpm typecheck` + affected package tests + `pnpm harness:scan` green.
- [ ] T11 (GATE-COMPLETE): after feature→develop merge (merge-verifier) + batched Stage-E develop→main promotion, move spec active→done and archive this task.

## Test Plan / 검증

TDD, foundation-first: agent-remote-pairing crypto+protocol (isomorphic, WebCrypto) → host stores → gate
wiring → browser store. Authoritative = per-package vitest (crypto round-trip+negatives; mutual protocol
fail-closed incl. rogue-host; store round-trip+no-private-material+fail-fast; gate enroll/reconnect/deny;
e2e oracle rogue-host+MITM+replay; browser IndexedDB persist+non-extractable) + full typecheck + harness:scan.
