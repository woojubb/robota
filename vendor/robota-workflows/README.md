# Workflow artifact

The CLI consumes `@robota-sdk/workflows` 0.0.1 as a build-time dependency and bundles it with its host-owned SDK. The vendored tarball has SHA-256 `e94f8cca02623763b0f6b87048a637ff8c7e141a48433a14b53ec1ea7e188bba` and was built from workflow source `61ac2ddfa71425be7081665a0184e47b2ce4f7aa`. Its SDK peers explicitly support beta.102, beta.103, beta.104, beta.106 and beta.107, and the stable patch range `~3.0.0`. The prior 0.3.1 tarball is retained for rollback; it does not support the current SDK cohort.

Before a fixed-group SDK version bump, run the repository's version generator in a disposable checkout and qualify the resulting SDK workspace with a workflow artifact that explicitly supports that exact version. Verify generated product workspaces, frozen installation and host authority identity for the new combination before merging the bump. Update and review the workflow artifact first when its peer contract does not include the next SDK version. Package publication, tags and deployment are separate release steps.

To roll back the extraction, revert the consumer, lockfile and legacy source removal together to the pre-cutover revision. Do not assume an older workflow artifact supports the host SDK, and do not alter saved workflow data as part of rollback.
