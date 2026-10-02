import { readPackageVersion } from '@robota-sdk/agent-framework';

/**
 * Build-time version constant injected by the Node and Bun compilers from the CLI manifest.
 * It is an ambient declaration with NO runtime binding in source execution, so it must ONLY ever
 * be read through a `typeof` guard when no compiler has replaced it.
 * A bare read / `??` / truthiness check would throw `ReferenceError` and crash `the product` under Node.
 */
declare const __AGENT_VERSION__: string | undefined;

/**
 * Compiled Node generations and standalone Bun binaries use their embedded manifest version.
 * Source execution retains the existing {@link readPackageVersion} lookup.
 */
export const readVersion = (): string =>
  typeof __AGENT_VERSION__ !== 'undefined' && __AGENT_VERSION__
    ? __AGENT_VERSION__
    : readPackageVersion(import.meta.url);
