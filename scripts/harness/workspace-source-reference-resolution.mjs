import path from 'node:path';
import { isBuiltin } from 'node:module';

import {
  isRepositoryPath,
  nearestResolutionFile,
  readParsedResolutionInput,
  readSourceConfig,
} from './workspace-source-config-resolution.mjs';

const unresolved = (reason, evidenceInputs = []) => ({
  status: 'unresolved',
  reason,
  evidenceInputs,
});

function sourceCandidates(target) {
  if (target.endsWith('.js')) return [target.slice(0, -3) + '.ts', target.slice(0, -3) + '.tsx'];
  if (target.endsWith('.mjs')) return [target.slice(0, -4) + '.mts'];
  if (target.endsWith('.cjs')) return [target.slice(0, -4) + '.cts'];
  if (
    !['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'].includes(
      path.posix.extname(target),
    )
  ) {
    return ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].flatMap((extension) => [
      target + extension,
      `${target}/index${extension}`,
    ]);
  }
  return [];
}

function resolveTarget(target, files, module = true) {
  if (!isRepositoryPath(target)) return unresolved('reference-escapes-repository');
  const targets = [target, ...(module ? sourceCandidates(target) : [])].filter((candidate) =>
    files.has(candidate),
  );
  if (targets.length !== 1) {
    return unresolved(targets.length === 0 ? 'missing-target' : 'ambiguous-target');
  }
  return { status: 'resolved', targets, evidenceInputs: [] };
}

function sourceExportTargets(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(sourceExportTargets);
  if (!value || typeof value !== 'object') return [];
  if (Object.hasOwn(value, 'source')) return sourceExportTargets(value.source);
  if (
    Object.keys(value).some(
      (condition) =>
        !['node', 'browser', 'import', 'require', 'default', 'types'].includes(condition),
    )
  ) {
    throw new Error('unsupported-export-condition');
  }
  return Object.entries(value)
    .filter(([condition]) => condition !== 'types')
    .flatMap(([, target]) => sourceExportTargets(target));
}

function exportedEntry(exports, subpath) {
  const subpathMap =
    exports &&
    typeof exports === 'object' &&
    Object.keys(exports).some((key) => key.startsWith('.'));
  if (!subpathMap) return { value: subpath === '.' ? exports : undefined };
  if (Object.hasOwn(exports, subpath)) return { value: exports[subpath] };
  const matches = Object.keys(exports)
    .filter((key) => {
      const [prefix, suffix, extra] = key.split('*');
      return (
        suffix !== undefined &&
        extra === undefined &&
        subpath.startsWith(prefix) &&
        subpath.endsWith(suffix) &&
        subpath.length >= key.length - 1
      );
    })
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
  if (!matches.length) return {};
  const key = matches[0];
  const [prefix, suffix] = key.split('*');
  return {
    value: exports[key],
    capture: subpath.slice(prefix.length, subpath.length - suffix.length),
  };
}

function resolvePackage(reference, owner, context) {
  const { files } = context;
  const manifestPath = `${owner.directory}/package.json`;
  if (!isRepositoryPath(manifestPath)) return unresolved('manifest-escapes-repository');
  if (!files.has(manifestPath)) return unresolved('missing-manifest', [manifestPath]);
  let manifest;
  try {
    manifest = readParsedResolutionInput(manifestPath, context, 'manifest');
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      throw new Error('invalid manifest');
  } catch {
    return unresolved('invalid-manifest', [manifestPath]);
  }
  const subpath =
    reference.specifier === owner.name ? '.' : `.${reference.specifier.slice(owner.name.length)}`;
  const exports = manifest.exports;
  if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
    const keys = Object.keys(exports);
    if (keys.some((key) => key.startsWith('.')) && keys.some((key) => !key.startsWith('.'))) {
      return unresolved('invalid-export-map', [manifestPath]);
    }
  }
  const entry = exportedEntry(exports, subpath);
  let declared;
  try {
    declared = [
      ...new Set(
        sourceExportTargets(entry.value).map((target) =>
          entry.capture === undefined ? target : target.replaceAll('*', entry.capture),
        ),
      ),
    ];
  } catch (error) {
    return unresolved(error.message, [manifestPath]);
  }
  if (declared.length !== 1) {
    return unresolved(declared.length ? 'ambiguous-export' : 'unexported-subpath', [manifestPath]);
  }
  const target = path.posix.normalize(path.posix.join(owner.directory, declared[0]));
  if (
    !declared[0].startsWith('./') ||
    !target.startsWith(`${owner.directory}/`) ||
    subpath.split('/').includes('..')
  ) {
    return { status: 'unresolved', reason: 'export-escapes-owner', evidenceInputs: [manifestPath] };
  }
  try {
    const segments = decodeURIComponent(declared[0]).slice(2).split('/');
    if (
      /%2f|%5c/i.test(declared[0]) ||
      declared[0].includes('\\') ||
      segments.some((part) => ['.', '..', 'node_modules'].includes(part.toLowerCase()))
    ) {
      return unresolved('invalid-export-target', [manifestPath]);
    }
  } catch {
    return unresolved('invalid-export-target', [manifestPath]);
  }
  const resolution = resolveTarget(target, files);
  return { ...resolution, evidenceInputs: [manifestPath] };
}

function resolveFileReference(reference, context) {
  const module = reference.kind === undefined || reference.kind === 'module';
  const anchor = reference.anchor ?? (module ? 'source' : 'cwd');
  if (!['source', 'cwd'].includes(anchor)) return unresolved('unknown-reference-anchor');
  if (
    reference.kind === 'execute' &&
    /^[A-Za-z0-9_.-]+$/u.test(reference.specifier) &&
    !reference.specifier.startsWith('.')
  ) {
    return { status: 'external', evidenceInputs: [] };
  }
  let directory = anchor === 'source' ? path.posix.dirname(reference.source) : context.cwd;
  if (directory === undefined) return unresolved('missing-cwd');
  if (!isRepositoryPath(directory)) return unresolved('reference-escapes-repository');
  if (reference.kind === 'execute' && anchor === 'cwd' && reference.executionCwd !== undefined) {
    const override = reference.executionCwd?.specifier;
    if (typeof override !== 'string') return unresolved('nonliteral-execution-cwd');
    if (path.posix.isAbsolute(override) || /^[a-zA-Z]:/.test(override)) {
      return unresolved('reference-escapes-repository');
    }
    directory = path.posix.join(directory, override);
    if (!isRepositoryPath(directory)) return unresolved('reference-escapes-repository');
  }
  if (reference.kind === 'list-names') return unresolved('directory-membership-unavailable');
  try {
    if (module && /%2f|%5c/i.test(reference.specifier)) return unresolved('invalid-reference-url');
    const specifier = module
      ? decodeURIComponent(reference.specifier.split(/[?#]/)[0])
      : reference.specifier;
    if (path.posix.isAbsolute(specifier)) return unresolved('reference-escapes-repository');
    const target = path.posix.normalize(path.posix.join(directory, specifier));
    if (reference.kind === 'config') {
      if (!isRepositoryPath(target)) return unresolved('reference-escapes-repository');
      const targets = [target, `${target}.json`, `${target}/tsconfig.json`].filter((file) =>
        context.files.has(file),
      );
      return targets.length === 1
        ? { status: 'resolved', targets, evidenceInputs: [reference.source, ...targets].sort() }
        : unresolved(
            targets.length ? 'ambiguous-config' : 'missing-config',
            [reference.source, target].sort(),
          );
    }
    return resolveTarget(target, context.files, module);
  } catch {
    return unresolved('invalid-reference-url');
  }
}

function resolveAlias(reference, context, config) {
  const paths = config.paths ?? {};
  const match = exportedEntry(
    Object.fromEntries(Object.entries(paths).map(([key, value]) => [`./${key}`, value])),
    `./${reference.specifier}`,
  );
  if (match.value === undefined) {
    if (config.baseUrl === undefined) return undefined;
    const result = resolveTarget(
      path.posix.join(config.baseUrl, reference.specifier),
      context.files,
    );
    return result.reason === 'missing-target'
      ? undefined
      : { ...result, evidenceInputs: config.evidenceInputs };
  }
  const targets = match.value.map((target) => {
    const mapped = match.capture === undefined ? target : target.replaceAll('*', match.capture);
    return resolveTarget(
      path.posix.join(config.baseUrl ?? config.pathsBase, mapped),
      context.files,
    );
  });
  const resolved = [...new Set(targets.flatMap((result) => result.targets ?? []))];
  if (targets.some((result) => result.reason === 'ambiguous-target') || resolved.length > 1) {
    return unresolved('ambiguous-alias', config.evidenceInputs);
  }
  return resolved.length === 1
    ? { status: 'resolved', targets: resolved, evidenceInputs: config.evidenceInputs }
    : unresolved('missing-alias-target', config.evidenceInputs);
}

function externalModule(reference, context, evidenceInputs) {
  const name = reference.specifier
    .split('/')
    .slice(0, reference.specifier.startsWith('@') ? 2 : 1)
    .join('/');
  const evidence = new Set(evidenceInputs);
  let manifest = {};
  const file = nearestResolutionFile(reference.source, 'package.json', context.files);
  if (file) {
    evidence.add(file);
    try {
      manifest = readParsedResolutionInput(file, context, 'manifest');
    } catch {
      return unresolved('invalid-manifest', [...evidence].sort());
    }
  }
  const declarations = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]
    .map((field) => manifest?.[field]?.[name])
    .filter((value) => typeof value === 'string');
  if (declarations.some((value) => /^(?:file|link|portal):/.test(value))) {
    return unresolved('local-dependency-protocol', [...evidence].sort());
  }
  const scope = name.startsWith('@') ? name.split('/')[0] + '/' : undefined;
  if (
    declarations.some((value) => value.startsWith('workspace:')) ||
    (scope && (context.packages ?? []).some((entry) => entry.name.startsWith(scope)))
  ) {
    return unresolved('unknown-workspace-module', [...evidence].sort());
  }
  return declarations.length
    ? { status: 'external', evidenceInputs: [...evidence].sort() }
    : unresolved('undeclared-module', [...evidence].sort());
}

function resolveNamedModule(reference, context) {
  const config = readSourceConfig(reference.source, context);
  if (config.reason) return unresolved(config.reason, config.evidenceInputs);
  const alias = resolveAlias(reference, context, config);
  if (alias) return alias;
  const owner = (context.packages ?? []).find(
    (entry) =>
      reference.specifier === entry.name || reference.specifier.startsWith(`${entry.name}/`),
  );
  if (!owner) return externalModule(reference, context, config.evidenceInputs);
  const resolution = resolvePackage(reference, owner, context);
  return {
    ...resolution,
    evidenceInputs: [...new Set([...config.evidenceInputs, ...resolution.evidenceInputs])].sort(),
  };
}

/** Resolve against the supplied regular-file inventory; never traverse the filesystem. */
export function resolveSourceReference(reference, context) {
  if (!isRepositoryPath(reference.source)) {
    return { ...reference, resolution: unresolved('reference-escapes-repository') };
  }
  if (reference.specifier === undefined) {
    return { ...reference, resolution: unresolved('nonliteral-reference') };
  }
  if (reference.specifier.startsWith('file:')) {
    return { ...reference, resolution: unresolved('absolute-file-url') };
  }
  if (reference.kind === 'config' && !reference.specifier.startsWith('.')) {
    return { ...reference, resolution: externalModule(reference, context, [reference.source]) };
  }
  if (reference.kind && reference.kind !== 'module') {
    return { ...reference, resolution: resolveFileReference(reference, context) };
  }
  if (isBuiltin(reference.specifier))
    return { ...reference, resolution: { status: 'builtin', evidenceInputs: [] } };
  if (
    path.posix.isAbsolute(reference.specifier) ||
    reference.specifier.includes('\\') ||
    /^[a-zA-Z]:[\\/]/.test(reference.specifier)
  ) {
    return { ...reference, resolution: unresolved('reference-escapes-repository') };
  }
  if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(reference.specifier)) {
    return { ...reference, resolution: unresolved('unsupported-module-url') };
  }
  if (!reference.specifier.startsWith('.')) {
    return { ...reference, resolution: resolveNamedModule(reference, context) };
  }
  return { ...reference, resolution: resolveFileReference(reference, context) };
}
