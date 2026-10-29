# Workflow artifact

The CLI consumes `@robota-sdk/workflows` 0.3.1 as a build-time dependency and bundles it with its host-owned SDK. The vendored tarball has SHA-256 `81b7156d3e6c091d51329c90a8fdf63b416c014736ca8d8fbd09916d3df84991` and was built from workflow source `f1f147e4feaa835c11a3dc995bb93f40ce709dea`. It supports SDK beta.102, beta.103 and beta.104. The workflow repository owns the runtime and artifact qualification; replacing this file dependency requires verifying its digest, SDK peers and CLI/App integration.

Before a fixed-group SDK version bump, run the repository's version generator in a disposable checkout and qualify the resulting SDK workspace with a workflow artifact that explicitly supports that exact version. Verify generated product workspaces, frozen installation and host authority identity for the new combination before merging the bump. Update and review the workflow artifact first when its peer contract does not include the next SDK version. Package publication, tags and deployment are separate release steps.

To roll back the extraction, revert the consumer, lockfile and legacy source removal together to the pre-cutover revision. Do not assume an older workflow artifact supports the host SDK, and do not alter saved workflow data as part of rollback.
