# Workflow artifact

The CLI consumes the exact npm release `@robota-sdk/workflows` 0.0.1 as a build-time dependency and bundles it with its host-owned SDK. The registry tarball has SHA-256 `e9d5efdd5545e5121a668511bc520e170df6099ec63edf01cfd8eedc206436c1` and was built from workflow source `88f867255bbb26e4bddbd9fa6b2209c628fc83a2`. Its SDK peers support the stable patch range `~3.0.0` and explicitly qualified beta versions. The previously vendored 0.0.1 and 0.3.1 tarballs remain as rollback evidence; their bytes are not the active registry dependency.

Before a fixed-group SDK version bump, run the repository's version generator in a disposable checkout and qualify the resulting SDK workspace with a workflow artifact that explicitly supports that exact version. Verify generated product workspaces, frozen installation and host authority identity for the new combination before merging the bump. Update and review the workflow artifact first when its peer contract does not include the next SDK version. Package publication, tags and deployment are separate release steps.

To roll back the extraction, revert the consumer, lockfile and legacy source removal together to the pre-cutover revision. Do not assume an older workflow artifact supports the host SDK, and do not alter saved workflow data as part of rollback.
