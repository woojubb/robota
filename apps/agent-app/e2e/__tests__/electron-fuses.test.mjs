import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

import { FuseV1Options, FuseVersion, INTENDED_FUSES, PlatformPackager, fuseMismatches } from '../electron-fuses.mjs';

const builderConfig = parse(
  readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8'),
);

/** What electron-builder hands `@electron/fuses` for the checked-in config. */
async function resolvedFuses() {
  expect(builderConfig.electronFuses, 'electron-builder.yml must set electronFuses').toBeDefined();
  return PlatformPackager.prototype.generateFuseConfig.call({}, builderConfig.electronFuses);
}

// The packaged main process holds the remote credentials, so a program running as the same OS user must not be able to
// borrow the signed binary: no `ELECTRON_RUN_AS_NODE` interpreter, no `NODE_OPTIONS` injection, no `--inspect`
// attach, and no app code loaded from anywhere but the asar (integrity-checked on macOS and Windows).
it('flips the Electron fuses that stop a same-user process from running code under the signed app', async () => {
  const fuses = await resolvedFuses();
  expect(fuses).toMatchObject({ version: FuseVersion.V1, ...INTENDED_FUSES });
  expect(INTENDED_FUSES).toMatchObject({
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  });
});

// Flipping a fuse breaks Electron's stock ad-hoc signature, and an Apple Silicon build nobody signs afterwards (identity
// null, as in the unsigned CI packaging) is then killed at launch. Signed builds are re-signed by electron-builder anyway.
it('re-signs the app ad hoc after the fuse flip so an unsigned Apple Silicon build still launches', async () => {
  const fuses = await resolvedFuses();
  expect(fuses.resetAdHocDarwinSignature).toBe(true);
});

// CI reads the wire of the binary it packaged: a config the packager ignored must fail there, not ship.
it('reports every intended fuse a packaged binary does not carry', () => {
  const [off, on] = ['0', '1'].map((state) => state.charCodeAt(0));
  const stock = { version: '1', 0: on, 1: off, 2: on, 3: on, 4: off, 5: off, 6: off, 7: on, 8: on };
  expect(fuseMismatches(stock)).toEqual([
    'RunAsNode: enabled, expected disabled',
    'EnableNodeOptionsEnvironmentVariable: enabled, expected disabled',
    'EnableNodeCliInspectArguments: enabled, expected disabled',
    'EnableEmbeddedAsarIntegrityValidation: disabled, expected enabled',
    'OnlyLoadAppFromAsar: disabled, expected enabled',
  ]);
  const fused = { ...stock, 0: off, 2: off, 3: off, 4: on, 5: on };
  expect(fuseMismatches(fused)).toEqual([]);
  expect(fuseMismatches({ version: '1', 0: off })).toContain('OnlyLoadAppFromAsar: missing, expected enabled');
  expect(fuseMismatches({ ...fused, version: '2' })).toEqual(['fuse wire version 2, expected 1']);
});
