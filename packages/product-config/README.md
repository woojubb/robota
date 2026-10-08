# Product configuration

The pure entry exports `PRODUCT_CONFIG_DESCRIPTORS`, `resolveProductConfig`, `generateDefaultEnvironment`, `publicProductConfig`, `parsePublicProductConfig`, `hostProductConfig`, and `embeddedProductIdentity`. Every call takes an explicit environment snapshot; it never consults ambient environment variables or previously resolved products.

`resolveProductConfig({ environment, fileValues?, defaults?, embeddedIdentity? })` applies environment, selected-file values, then defaults. Empty input clears optional values and rejects required values. When artifact identity is supplied, selected-file and product-alias identity inputs must agree with it; operational settings remain configurable. Ambient canonical `PRODUCT_*`, `PROJECT_*`, `SERVICE_*`, `SECURITY_*` and `DEPLOY_*` inputs (including `PRODUCT_CONFIG_FILE` and technical inputs outside the descriptors) apply only when `PRODUCT_ID` matches the artifact. Otherwise use the product-prefixed aliases or an explicit host file selection.

`loadProductConfig({ environment, filePath?, defaults?, embeddedIdentity?, readFile? })` from the `/node` entry reads only an explicit absolute file path or the canonical `PRODUCT_CONFIG_FILE` selection. `loadProductConfigSelection` returns both the resolved descriptor and file entries from the same read, so a host can pass operational inputs to its adapters. Relative host paths resolve against the selected file directory. Neither loader expands environment references, reads key files, or searches the working directory.

The descriptor contract also produces `.env.default` guidance. Required product values have no product-specific defaults. Public projections include cryptographic domain labels needed by peers, while excluding master derivation indices and host storage paths. Generated identity keys remain in the configured credential store or user state root; key and trust-store file imports are not supported settings.

## Product builds and release workflows

Copy the repository's `.env.default` guidance into a private product environment file and fill the required identity, storage, credential-domain, and cryptographic-domain values. Select it by an absolute path with `PRODUCT_CONFIG_FILE` when building or running the common source. Optional `SERVICE_ANALYTICS_MEASUREMENT_ID` enables the blog's Google Analytics account for that product; leaving it empty omits the tracking scripts.

Generate distribution artifacts in a separate workspace:

```bash
pnpm exec tsx scripts/product/generate-workspace.mjs --env /absolute/path/product.env --out /absolute/path/generated-product
cd /absolute/path/generated-product
pnpm install --frozen-lockfile
pnpm build
```

GitHub release and npm publication workflows accept the non-secret file contents as the `product_env` dispatch input, or use the repository variable `PRODUCT_BUILD_ENV`. They validate that selection before compiling in a generated workspace and pass the resolved contract to later steps. Keep credentials in the existing protected workflow secrets, outside these product inputs. Native releases and version tagging require `PROJECT_RELEASE_TAG_PREFIX`; npm publication also needs the repository URL and registry URL. `PROJECT_PACKAGE_ACCESS` selects the publication access policy. The selected access is reflected in generated package manifests and Changesets configuration. A tag-triggered release uses the configured repository variable; a successful native tag release starts desktop packaging with the same selection.

Pull requests use isolated synthetic Cedar and Amber configurations for native and desktop validation. Those jobs do not sign or publish artifacts. Publication dry runs pack and verify packages without using release credentials.

## Artifact runtime defaults and shared settings

Build inputs can declare `PRODUCT_DEFAULT_USER_STATE_DIR`, `PRODUCT_DEFAULT_CACHE_DIR`, and
`PRODUCT_DEFAULT_LOG_DIR` as paths relative to the invocation home, such as `.cedar`, `.cedar/cache`,
and `.cedar/logs`. `PRODUCT_DEFAULT_PROJECT_STATE_DIR` declares the workspace state directory, such
as `.cedar`. Absolute paths, home-variable expressions and traversal are refused. The generator
writes these non-secret defaults beside identity in `.product/runtime-defaults.json` and embeds them
in Node/native CLI builds; the desktop copies the same defaults into its resources. Explicit
matching environment values and selected-file values override them. Build-machine operational
roots and credentials are never inferred as artifact defaults.

`PRODUCT_SHARED_USER_SETTINGS` is a JSON array of home-relative files; its default is
`[".claude/settings.json"]`. `PRODUCT_SHARED_PROJECT_SETTINGS` is a JSON array of objects with
`scope` (`project` or `project-local`) and `relativePath`; its defaults are the two existing
`.claude/settings*.json` sources. Set either input to `[]` to disable that compatibility layer.
Product-owned user/project settings remain available, and project sources still require workspace
trust. Generated artifacts carry the selected shared source defaults through all hosts.

## Public site builds

Cloudflare Pages must build a generated product workspace, rather than the neutral application source. Use the shared entrypoint with `www`, `docs`, or `blog`:

```bash
PRODUCT_CONFIG_FILE=/absolute/path/product.env pnpm exec tsx scripts/product/build-site.mjs www
```

Pages builds can instead supply the same non-secret file contents through `PRODUCT_BUILD_ENV`. Configure the build command as `pnpm exec tsx scripts/product/build-site.mjs <site>` and keep the output directory `apps/www/out`, `apps/docs/out`, or `apps/blog/dist`. Supply the public homepage, documentation, blog and repository URLs (the sites link to one another), and the selected site's `DEPLOY_PROJECT_NAME`, `DEPLOY_DOCS_PROJECT_NAME`, or `DEPLOY_BLOG_PROJECT_NAME`. The entrypoint validates the selection, generates an isolated workspace, installs with the frozen lockfile, runs the existing app build, and copies only verified static output to the Pages destination. Missing configuration, build failures, or unresolved public product placeholders stop the build. Temporary workspaces are removed on success and failure; raw source and existing local development commands remain unchanged. Keep credentials outside `PRODUCT_BUILD_ENV`.

The source apps' `deploy` scripts use the same entrypoint with `--deploy`; they publish only after configuration and static-output verification succeed, using the selected Pages project and production branch. Supply the product selection and use an existing Wrangler login.
