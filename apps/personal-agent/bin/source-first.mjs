// Resolve each module through its `source` export condition when that file exists, and through the
// package's normal export otherwise. Workspace packages then run from their sources, while a
// published package pinned by a product module, whose tarball ships no sources, still resolves.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const withoutSource = context.conditions.filter((condition) => condition !== 'source');
  try {
    const resolved = await nextResolve(specifier, { ...context, conditions: [...withoutSource, 'source'] });
    if (!resolved.url.startsWith('file:') || existsSync(fileURLToPath(resolved.url))) return resolved;
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  return nextResolve(specifier, { ...context, conditions: withoutSource });
}
