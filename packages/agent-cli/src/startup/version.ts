import { readPackageVersion } from '@robota-sdk/agent-framework';

/**
 * Build-time version constant injected ONLY by the Bun single-binary build (DIST-001) via
 * `--define __ROBOTA_VERSION__`. It is an ambient declaration with NO runtime binding — in the normal
 * Node path it is an *undeclared* identifier, so it must ONLY ever be read through a `typeof` guard.
 * A bare read / `??` / truthiness check would throw `ReferenceError` and crash `robota` under Node.
 */
declare const __ROBOTA_VERSION__: string | undefined;

/**
 * Resolve the CLI version. In the Bun single binary the fs-walk in {@link readPackageVersion} cannot find
 * `package.json` (the binary has no filesystem layout), so it would return the `0.0.0` fallback; the Bun
 * build injects the real version via `__ROBOTA_VERSION__`. In Node, `typeof __ROBOTA_VERSION__` is
 * `'undefined'` (the identifier is not declared), so this is byte-identical to the previous behavior.
 */
export const readVersion = (): string =>
  typeof __ROBOTA_VERSION__ !== 'undefined' && __ROBOTA_VERSION__
    ? __ROBOTA_VERSION__
    : readPackageVersion(import.meta.url);
