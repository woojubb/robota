# Changelog

## 3.0.0-beta.88
### Patch Changes

- dfde075: Generated products can select a CLI package binary, version and build label, native host entry and artifact name, and desktop identity. Artifact metadata records the source version and provenance. Clean-tree generation copies only the committed source tree, while the built-in desktop remains packageable without generation.
- cf4fff8: Generated products can declare home-relative operational defaults and choose shared user/project settings sources. Installed artifacts scope ambient canonical variables to their product identity before file selection and child execution. Use matching PRODUCT_ID with canonical overrides or product-prefixed aliases.

  The public startCliEntry function installs the complete CLI diagnostics and crash policy while preserving startCli worker dispatch. Diagnostics use the configured CLI name; headless Restricted runs report ignored project settings and trust refusals name the full product command.

## 3.0.0-beta.87

### Patch Changes

- 66af868: Restore portable default startup for generated Robota artifacts while preserving explicit product selection and immutable identity. Keep shared product configuration internal because existing SDK and CLI artifacts bundle its implementation and types.

## 3.0.0-beta.86

- Add explicit product configuration, validated environment-file selection, and separate public and host projections.
