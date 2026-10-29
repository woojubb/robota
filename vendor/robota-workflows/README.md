# Workflow artifact

The CLI consumes `@robota-sdk/workflows` 0.0.1 as a build-time dependency and bundles it with its host-owned SDK. The vendored tarball has SHA-256 `50c14fcddf8a9be22d458b58f8bec24d691cf08048ee55f34a9b89b3cb5d65ee` and was built from workflow source `d324b16fcb9109b6569f60692290c29b3c5f8e7d`. Its SDK peers explicitly support beta.102, beta.103, beta.104, beta.106 and beta.107. The prior 0.3.1 tarball is retained for rollback; it does not support the current SDK cohort.

Before a fixed-group SDK version bump, run the repository's version generator in a disposable checkout and qualify the resulting SDK workspace with a workflow artifact that explicitly supports that exact version. Verify generated product workspaces, frozen installation and host authority identity for the new combination before merging the bump. Update and review the workflow artifact first when its peer contract does not include the next SDK version. Package publication, tags and deployment are separate release steps.

To roll back the extraction, revert the consumer, lockfile and legacy source removal together to the pre-cutover revision. Do not assume an older workflow artifact supports the host SDK, and do not alter saved workflow data as part of rollback.
