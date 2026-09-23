import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function repositoryRelative(root, absolute) {
  const relative = path.relative(root, absolute).replaceAll('\\', '/');
  return relative === '' || relative.startsWith('../') || path.isAbsolute(relative)
    ? null
    : relative;
}

function relativeImportSpecifiers(source) {
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
  const pattern =
    /(?:import|export)[^'"]*from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)|import\s*['"](\.[^'"]+)['"]/gu;
  const specifiers = [];
  let match;
  while ((match = pattern.exec(uncommented)) !== null) {
    specifiers.push(match[1] ?? match[2] ?? match[3]);
  }
  return specifiers;
}

function resolveLocalImport(root, importer, specifier) {
  const raw = path.resolve(path.dirname(path.join(root, importer)), specifier);
  const candidates = path.extname(raw)
    ? [raw]
    : [raw, `${raw}.mjs`, `${raw}.js`, `${raw}.cjs`, `${raw}.json`];
  for (const candidate of candidates) {
    const relative = repositoryRelative(root, candidate);
    if (relative === null) {
      throw new Error(`local import escapes the repository: ${importer} -> ${specifier}`);
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative;
  }
  throw new Error(`unresolved local import: ${importer} -> ${specifier}`);
}

/** Every repository-local module reachable through a literal import/export edge, entry included. */
export function literalLocalImportClosure(root, entries) {
  const closure = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const current = pending.pop();
    if (closure.has(current)) continue;
    const absolute = path.join(root, current);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`import-closure entry is missing: ${current}`);
    }
    closure.add(current);
    const source = readFileSync(absolute, 'utf8');
    for (const specifier of relativeImportSpecifiers(source)) {
      pending.push(resolveLocalImport(root, current, specifier));
    }
  }
  return [...closure].sort();
}
