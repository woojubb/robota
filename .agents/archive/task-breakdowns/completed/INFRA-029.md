# INFRA-029 — publish-packages.sh version-scoped detection + single-OTP flow

- **Status:** completed (merged #1012 → #1013)
- **Spec:** `.agents/spec-docs/done/INFRA-029-publish-single-otp-flow.md`

## Outcome

`scripts/publish/publish-packages.sh`: (1) publishable detection filters `private:false` AND
`version === VERSION` so off-version packages (agent-process at beta.77) no longer make the
exposure-wait hang; (2) a build preflight runs before the OTP prompt (`--skip-build` opt-out) so
entering the OTP runs the publish immediately; (3) the beta dist-tag sync is issued in parallel so
publish + tag sync fit one OTP window. Verified via detection assertion, `--skip-build` trace, `bash
-n`, harness characterization test (78 tests, +3 invariants), 45/45 scans. Surfaced by the 3.0.0-beta.79
release (OTP requested 4×).
