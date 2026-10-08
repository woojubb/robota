import { readPackageVersion } from '@robota-sdk/agent-framework';
import { readFileSync } from 'node:fs';

/**
 * Build-time version constant injected by the Node and Bun compilers from the CLI manifest.
 * It is an ambient declaration with NO runtime binding in source execution, so it must ONLY ever
 * be read through a `typeof` guard when no compiler has replaced it.
 * A bare read / `??` / truthiness check would throw `ReferenceError` and crash `the product` under Node.
 */
declare const __AGENT_VERSION__: string | undefined;
declare const __AGENT_SOURCE_VERSION__: string | undefined;
declare const __AGENT_BUILD_METADATA__: string | null | undefined;

function sourceArtifactMetadata(): { sourceVersion?: string; buildMetadata?: string | null } | undefined {
  try {
    return JSON.parse(readFileSync(new URL('../../../../.product/artifact-metadata.json', import.meta.url), 'utf8')) as {
      sourceVersion?: string; buildMetadata?: string | null;
    };
  } catch {
    return undefined;
  }
}

/**
 * Compiled Node generations and standalone Bun binaries use their embedded manifest version.
 * Source execution retains the existing {@link readPackageVersion} lookup.
 */
export const readVersion = (): string =>
  typeof __AGENT_VERSION__ !== 'undefined' && __AGENT_VERSION__
    ? __AGENT_VERSION__
    : readPackageVersion(import.meta.url);

export const readSourceVersion = (): string =>
  typeof __AGENT_SOURCE_VERSION__ !== 'undefined' && __AGENT_SOURCE_VERSION__
    ? __AGENT_SOURCE_VERSION__
    : sourceArtifactMetadata()?.sourceVersion ?? readPackageVersion(import.meta.url);

export const readBuildMetadata = (): string | null =>
  typeof __AGENT_BUILD_METADATA__ !== 'undefined'
    ? __AGENT_BUILD_METADATA__ ?? null
    : sourceArtifactMetadata()?.buildMetadata ?? null;
