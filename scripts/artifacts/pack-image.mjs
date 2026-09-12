/** A disposable, ordinary-file image. dist expectations belong to the emitter manifest. */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { readWorkspaceGraph } from '../harness/workspace-graph.mjs';
import { validateArtifactPath, validateManifest } from './manifest.mjs';
import { expectedPublishManifest, PACK_DEPENDENCY_FIELDS } from './pack-expected.mjs';
import { materializeGeneration } from './generation-image.mjs';
import { GENERATION_DIRECTORY } from './writer-lock.mjs';

const FILE_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;
const digest = (contents) => createHash('sha256').update(contents).digest('hex');
const LICENSE = /^licen[cs]e(?:\..+)?$/iu;
const DOCUMENT = /^(?:readme|copying|licen[cs]e)(?:\..+)?$/iu;

export function readWorkspaceVersions(workspaceRoot) {
  return new Map(
    readWorkspaceGraph(workspaceRoot).packages.map((entry) => {
      const manifest = JSON.parse(
        readFileSync(path.join(workspaceRoot, entry.directory, 'package.json'), 'utf8'),
      );
      return [entry.name, manifest.version];
    }),
  );
}

function literalPath(value) {
  if (typeof value !== 'string' || /[!*?{}[\]]/u.test(value)) {
    throw new Error(`pack: unsupported inclusion pattern ${JSON.stringify(value)}`);
  }
  const result = validateArtifactPath(value.replace(/^\.\//u, '').replace(/\/$/u, ''));
  if (
    result.split('/').some((part) => ['node_modules', '.git', GENERATION_DIRECTORY].includes(part))
  ) {
    throw new Error(`pack: unsupported inclusion path ${value}`);
  }
  return result;
}

function regularSource(root, relative) {
  const parts = relative.split('/');
  for (let index = 1; index <= parts.length; index++) {
    const source = path.join(root, ...parts.slice(0, index));
    const stat = lstatSync(source);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error(`pack: non-regular source ${relative}`);
    }
  }
  return path.join(root, relative);
}

function addStaticFiles(sources, root, relative) {
  const absolute = regularSource(root, relative);
  if (lstatSync(absolute).isDirectory()) {
    for (const name of readdirSync(absolute)) addStaticFiles(sources, root, `${relative}/${name}`);
  } else {
    sources.set(relative, absolute);
  }
}

function staticSources(packageRoot, workspaceRoot, original) {
  if (!Array.isArray(original.files) || !original.files.map(literalPath).includes('dist')) {
    throw new Error('pack: files must explicitly include the complete dist directory');
  }
  const sources = new Map();
  const selected = new Set([
    ...original.files.map(literalPath),
    ...readdirSync(packageRoot).filter((name) => DOCUMENT.test(name)),
  ]);
  if (original.main) selected.add(literalPath(original.main));
  const bins =
    typeof original.bin === 'string' ? [original.bin] : Object.values(original.bin ?? {});
  for (const bin of bins) selected.add(literalPath(bin));
  for (const relative of selected) {
    if (relative === 'package.json' || relative === 'dist' || relative.startsWith('dist/'))
      continue;
    if (existsSync(path.join(packageRoot, relative)))
      addStaticFiles(sources, packageRoot, relative);
  }
  if (![...sources.keys()].some((name) => /LICEN[CS]E(\..+)?/iu.test(name))) {
    for (const name of readdirSync(workspaceRoot).filter((name) => LICENSE.test(name))) {
      sources.set(name, regularSource(workspaceRoot, name));
    }
  }
  return sources;
}

function putFile(imageRoot, relative, contents, mode) {
  const destination = path.join(imageRoot, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents, { flag: 'wx', mode });
  chmodSync(destination, mode);
}

function materializeWorkspaceVersions(imageRoot, original, versions) {
  const names = new Set(
    PACK_DEPENDENCY_FIELDS.flatMap((field) =>
      Object.entries(original[field] ?? {})
        .filter(([, range]) => range.startsWith('workspace:'))
        .map(([name]) => name),
    ),
  );
  for (const name of names) {
    validateArtifactPath(name);
    putFile(
      imageRoot,
      `node_modules/${name}/package.json`,
      JSON.stringify({ name, version: versions.get(name) }),
      FILE_MODE,
    );
  }
}

export function materializePackImage({
  packageRoot,
  imageRoot,
  pinned,
  workspaceRoot,
  workspaceVersions = readWorkspaceVersions(workspaceRoot),
}) {
  const original = JSON.parse(readFileSync(regularSource(packageRoot, 'package.json'), 'utf8'));
  const manifest = expectedPublishManifest(original, workspaceVersions);
  const sources = staticSources(packageRoot, workspaceRoot, original);
  mkdirSync(imageRoot);
  const bins =
    typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
  const executable = new Set(
    [...bins, ...(manifest.publishConfig?.executableFiles ?? [])].map(literalPath),
  );
  materializeGeneration(pinned, path.join(imageRoot, 'dist'));
  const expectedFiles = pinned.manifest.files.map((record) => ({
    ...record,
    path: `dist/${record.path}`,
    mode: executable.has(`dist/${record.path}`) ? EXECUTABLE_MODE : FILE_MODE,
  }));
  for (const [relative, source] of sources) {
    const contents = readFileSync(source);
    const mode = executable.has(relative) ? EXECUTABLE_MODE : FILE_MODE;
    putFile(imageRoot, relative, contents, mode);
    expectedFiles.push({ path: relative, sha256: digest(contents), mode });
  }
  putFile(imageRoot, 'package.json', JSON.stringify(original, null, 2), FILE_MODE);
  expectedFiles.push({
    path: 'package.json',
    sha256: digest(JSON.stringify(manifest, null, 2)),
    mode: FILE_MODE,
  });
  materializeWorkspaceVersions(imageRoot, original, workspaceVersions);
  validateManifest({ version: 1, files: expectedFiles });
  const included = new Set(expectedFiles.map((record) => record.path));
  for (const executablePath of executable) {
    if (!included.has(executablePath))
      throw new Error(`pack: missing executable ${executablePath}`);
  }
  return { manifest, expectedFiles };
}
