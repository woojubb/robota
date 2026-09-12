#!/usr/bin/env node
// The verified wrapper packs a physical image with lifecycle scripts disabled.
// No environment-variable bypass: direct package-directory packing has no pinned generation.
process.stderr.write(
  'Direct package-directory packing is unsupported. From the workspace root, use:\n' +
    '  node scripts/artifacts/pack.mjs --package <package-directory> --destination <tarball-directory>\n',
);
process.exitCode = 1;
