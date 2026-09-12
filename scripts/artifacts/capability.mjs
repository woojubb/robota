import { validateArtifactPath } from './manifest.mjs';
import { validateOutputName } from './writer-lock.mjs';

function readVariants(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('robota.artifact.variants must be an object keyed by variant name');
  }
  const outputs = new Set(['dist']);
  return Object.fromEntries(
    Object.entries(value).map(([name, variant]) => {
      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) ||
        !variant ||
        typeof variant !== 'object' ||
        Array.isArray(variant) ||
        typeof variant.output !== 'string'
      ) {
        throw new Error(`robota.artifact.variants.${name} must declare an output name`);
      }
      const output = validateOutputName(variant.output);
      if (outputs.has(output))
        throw new Error(`robota.artifact.variants output overlaps: ${output}`);
      outputs.add(output);
      return [name, { output }];
    }),
  );
}

/** Single boundary parser shared by graph discovery and package assembly. */
export function readArtifactCapability(manifest) {
  const value = manifest.robota?.artifact;
  if (value === undefined) return undefined;
  if (!value || !['tsdown', 'vite'].includes(value.builder)) {
    throw new Error('robota.artifact.builder must be tsdown or vite');
  }
  if (value.copies !== undefined && !Array.isArray(value.copies)) {
    throw new Error('robota.artifact.copies must be an array');
  }
  const targets = [];
  const copies = (value.copies ?? []).map((copy) => {
    if (
      !copy ||
      typeof copy.package !== 'string' ||
      !copy.package.trim() ||
      copy.package !== copy.package.trim()
    ) {
      throw new Error('robota.artifact.copies.package must be a nonempty workspace package name');
    }
    const target = validateArtifactPath(copy.target);
    const key = target.toLowerCase();
    if (
      targets.some(
        (prior) => key === prior || key.startsWith(`${prior}/`) || prior.startsWith(`${key}/`),
      )
    ) {
      throw new Error(`robota.artifact.copies has overlapping targets: ${target}`);
    }
    targets.push(key);
    return { package: copy.package, target };
  });
  return {
    builder: value.builder,
    ...(value.copies === undefined ? {} : { copies }),
    ...(value.variants === undefined ? {} : { variants: readVariants(value.variants) }),
  };
}
