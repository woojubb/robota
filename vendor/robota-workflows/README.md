# Workflow artifact

The CLI consumes the exact npm release `@robota-sdk/workflows` 0.0.4 as a build-time dependency and bundles it with its host-owned SDK. The registry tarball has SHA-256 `96950e1087ea81c35fccbb21d998992325960b61ead2a3c706e6508ca43f3773` and was built from workflow source `8629d121828607e3f8317e94099a180e66afa9a4`. Its SDK peers support the stable patch range `~3.1.0`. The previously vendored 0.0.1 and 0.3.1 tarballs remain as rollback evidence; their bytes are not the active registry dependency.

Before a fixed-group SDK version bump, run the repository's version generator in a disposable checkout and qualify the resulting SDK workspace with a workflow artifact that explicitly supports that exact version. Verify generated product workspaces, frozen installation and host authority identity for the new combination before merging the bump. Update and review the workflow artifact first when its peer contract does not include the next SDK version. Package publication, tags and deployment are separate release steps.

To roll back the extraction, revert the consumer, lockfile and legacy source removal together to the pre-cutover revision. Do not assume an older workflow artifact supports the host SDK, and do not alter saved workflow data as part of rollback.
