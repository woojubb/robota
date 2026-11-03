// The Electron fuses the packaged desktop app must carry, and a check of the fuse wire read from a packaged binary.
import { createRequire } from 'node:module';

const appRequire = createRequire(new URL('../package.json', import.meta.url));
const builderRequire = createRequire(appRequire.resolve('electron-builder'));
builderRequire('app-builder-lib'); // loads the package entry first: platformPackager.js alone trips a circular import
// The `@electron/fuses` electron-builder flips the fuses with, so reading and writing agree on the wire layout.
const fusesRequire = createRequire(builderRequire.resolve('app-builder-lib'));
export const { FuseV1Options, FuseVersion, getCurrentFuseWire } = fusesRequire('@electron/fuses');
const { FuseState } = fusesRequire('@electron/fuses/dist/constants.js');
/** What electron-builder hands `@electron/fuses` for an `electronFuses` section of its config. */
export const { PlatformPackager } = builderRequire('app-builder-lib/out/platformPackager.js');

/**
 * The packaged main process holds the remote credentials, so a program running as the same OS user must not be able to
 * borrow the binary: no `ELECTRON_RUN_AS_NODE` interpreter, no `NODE_OPTIONS` injection, no `--inspect` attach, and no
 * app code loaded from anywhere but the integrity-checked asar. Fuses not named here stay at Electron's defaults.
 */
export const INTENDED_FUSES = Object.freeze({
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
});

const stateName = (state) =>
  ({ [FuseState.ENABLE]: 'enabled', [FuseState.DISABLE]: 'disabled', [FuseState.REMOVED]: 'removed' })[state] ??
  'missing';

/** Every intended fuse the wire does not carry, described for a failure message; empty when all match. */
export function fuseMismatches(wire) {
  if (wire.version !== FuseVersion.V1) return [`fuse wire version ${wire.version}, expected ${FuseVersion.V1}`];
  return Object.entries(INTENDED_FUSES)
    .filter(([fuse, enabled]) => wire[fuse] !== (enabled ? FuseState.ENABLE : FuseState.DISABLE))
    .map(([fuse, enabled]) => `${FuseV1Options[fuse]}: ${stateName(wire[fuse])}, expected ${enabled ? 'enabled' : 'disabled'}`);
}
