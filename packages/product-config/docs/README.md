# Product configuration

The pure entry exports `PRODUCT_CONFIG_DESCRIPTORS`, `PRODUCT_CONFIG_FILE_VARIABLE`, `ProductConfigError`, `productConfigEntries`, `productSettingAlias`, `resolveProductConfig`, `generateDefaultEnvironment`, `publicProductConfig`, `parsePublicProductConfig`, `hostProductConfig`, `embeddedProductIdentity`, `parseEmbeddedProductIdentity`, `scopeProductEnvironment`, `embeddedProductRuntimeDefaults`, and `parseProductRuntimeDefaults`, with their types. Every call takes an explicit environment snapshot; it never consults ambient environment variables or previously resolved products. The identity parser validates and freezes a consumer-owned entry's non-secret artifact identity before CLI launch.

`resolveProductConfig({ environment, fileValues?, defaults?, embeddedIdentity? })` applies environment, selected-file values, then defaults. Empty input clears optional values and rejects required values. When artifact identity is supplied, selected-file and product-alias identity inputs must agree with it; operational settings remain configurable. Ambient canonical `PRODUCT_*`, `PROJECT_*`, `SERVICE_*`, `SECURITY_*` and `DEPLOY_*` inputs (including `PRODUCT_CONFIG_FILE` and technical inputs outside the descriptors) apply only when `PRODUCT_ID` matches the artifact. Otherwise use the product-prefixed aliases or an explicit host file selection.

`loadProductConfig({ environment, filePath?, defaults?, embeddedIdentity?, readFile? })` from the `/node` entry reads only an explicit absolute file path or the canonical `PRODUCT_CONFIG_FILE` selection. `loadProductConfigSelection` returns both the resolved descriptor and file entries from the same read, so a host can pass operational inputs to its adapters. Relative host paths resolve against the selected file directory. Neither loader expands environment references, reads key files, or searches the working directory. The `/node` entry also exports `parseProductEnvironmentFile`, which parses environment-file syntax without expansion, and `expandProductRuntimeDefaults`, which resolves the declared artifact roots against an absolute invocation home.

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

The native binary, desktop app and version-tagging workflows accept the non-secret file contents as the `product_env` dispatch input, or use the repository variable `PRODUCT_BUILD_ENV`; the npm publication workflow uses the repository variable. They validate that selection before compiling in a generated workspace and pass the resolved contract to later steps. Keep credentials in the existing protected workflow secrets, outside these product inputs. Native releases, version tagging and npm publication require `PROJECT_RELEASE_TAG_PREFIX`; npm publication also needs the repository URL and registry URL. `PROJECT_PACKAGE_ACCESS` selects the publication access policy. The selected access is reflected in generated package manifests and Changesets configuration. A pushed release tag starts the native binary and desktop workflows independently, each reading the repository variable.

Pull requests use an isolated synthetic Cedar configuration for CI and native binary validation; the native binary jobs on a pull request build and check binaries and publish nothing. npm publication packs the release tarballs in a job without publication credentials and publishes those exact tarballs in a separate, approved job.
