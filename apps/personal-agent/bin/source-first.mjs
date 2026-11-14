// Resolve workspace modules through their `source` export condition when that file exists, and
// everything else through its normal export. Workspace packages then run from their sources, while a
// published package pinned by a product module runs from the build it ships, sources or not.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  const withoutSource = context.conditions.filter((condition) => condition !== 'source');
  try {
    const resolved = await nextResolve(specifier, { ...context, conditions: [...withoutSource, 'source'] });
    if (!resolved.url.startsWith('file:')) return resolved;
    const path = fileURLToPath(resolved.url);
    if (!path.split(/[\\/]/).includes('node_modules') && existsSync(path)) return resolved;
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  return nextResolve(specifier, { ...context, conditions: withoutSource });
}
