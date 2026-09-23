#!/usr/bin/env node

/**
 * Sole owner of unresolved @robota-sdk/* package names in live repository inputs.
 * Reads workspace manifests, helper scripts, live Markdown prose and pnpm commands,
 * diagrams, and source comments. Historical records, tests, and fixtures describe
 * past or deliberately invalid names rather than commands to run today.
 *
 * Lesson source: the agent-web → agent-web-ui package rename left a stale
 * filter token (old web package name) in agent-cli's build script — develop
 * was locally unbuildable and nothing detected it (HARNESS-004, 2026-06-11).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ABSENCE_VOCABULARY } from './cited-paths.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { filterScriptOccurrences, isSelector } from './lib/pnpm-invocation.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';
import { SOURCE_EXTENSIONS, listAppDirs, listManifestPackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

// One npm-name grammar. A match is still checked for pnpm selector punctuation below.
export const TOKEN_PATTERN = /@robota-sdk\/[a-z0-9]+(?:-[a-z0-9]+)*(?![\w-])/g;

// Example/fixture tokens used inside harness scripts' own rule tables and allowlists.
const GROUP_CONTAINER_NAME = '@robota-sdk/dag-nodes';
const EXAMPLE_TOKEN_ALLOWLIST = new Set([
  '@robota-sdk/agent-provider', // removed monolith; remains only as a forbidden-PREFIX literal in check-agent-server-boundary (matches all agent-provider-* leaves)
  '@robota-sdk/other',
  GROUP_CONTAINER_NAME,
]);

const PLACEHOLDER_NAMES = new Set(['foo', 'bar', 'baz', 'name', 'your-package']);
const FRONT_DOOR_DOCS = new Set(['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CLAUDE.md']);
const SKIP_TREES = new Set([
  '.git',
  '.claude',
  'node_modules',
  'dist',
  'coverage',
  '__tests__',
  '__fixtures__',
  'fixtures',
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listPackageJsonFiles(root) {
  const files = [];
  const rootPkg = path.join(root, 'package.json');
  if (existsSync(rootPkg)) files.push(rootPkg);
  for (const dir of [...listManifestPackageDirs(root), ...listAppDirs(root)])
    files.push(path.join(dir, 'package.json'));
  return files;
}

/** Historical paths are excluded by kind; a pending changeset header and pre.json are live. */
export function isImmutableHistoricalRecord(rel) {
  const p = `/${rel.split(path.sep).join('/')}`;
  if (path.basename(p) === 'CHANGELOG.md') return true;
  if (/\/\.changeset\/[^/]+\.md$/.test(p)) return true;
  if (/\/\.agents\/spec-docs\/(done|rejected)\//.test(p)) return true;
  if (/\/\.agents\/tasks\/completed\//.test(p)) return true;
  if (/\/\.agents\/archive\//.test(p)) return true;
  if (/\/\.agents\/release-runs\//.test(p)) return true;
  if (/\/content\/v\d/.test(p)) return true;
  if (/\/docs\/superpowers\//.test(p)) return true;
  if (/\/docs\/plans\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(p)) return true; // dated design and implementation plans
  if (/\/\.design\//.test(p)) return true;
  return false;
}

/** Authored docs, diagrams and source, without following symlinks into dependencies or worktrees. */
function listReferenceFiles(root) {
  const files = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_TREES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        ['.md', '.mmd', ...SOURCE_EXTENSIONS].includes(path.extname(entry.name))
      )
        files.push(full);
    }
  }
  walk(root);
  return files;
}

function isConcreteName(text, match) {
  const before = text[match.index - 1] ?? '';
  if (before === '!' || before === '/') return false;
  const suffix = text.slice(match.index + match[0].length).split(/[\s`'"<>),;]/, 1)[0];
  return !isSelector(match[0] + suffix);
}

function changesetHeader(text) {
  const match = /^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/.exec(text);
  return match?.[1] ?? '';
}

function commentLines(text) {
  let inBlock = false;
  const comments = [];
  for (const line of text.split('\n')) {
    const blockStart = line.indexOf('/*');
    if (blockStart >= 0) inBlock = true;
    const slash = line.indexOf('//');
    if (inBlock || slash >= 0) comments.push(slash >= 0 && !inBlock ? line.slice(slash) : line);
    if (inBlock && line.includes('*/')) inBlock = false;
  }
  return comments;
}

function listHelperScripts(root) {
  const results = [];

  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_TREES.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        results.push(full);
      }
    }
  }

  walk(path.join(root, 'scripts'));
  for (const dir of [...listManifestPackageDirs(root), ...listAppDirs(root)])
    walk(path.join(dir, 'scripts'));
  return results;
}

/**
 * SSOT for "the set of every workspace package `name`".
 *
 * The walk itself is `readWorkspaceManifests` below; this is its name projection. It is
 * nesting-aware for `packages/` (via workspace-packages.mjs) so nested-group members like
 * `packages/dag-nodes/<name>` are included in both the resolved-name set and scan corpus.
 */
export function listWorkspacePackageNames(root = WORKSPACE_ROOT) {
  return new Set(readWorkspaceManifests(root).keys());
}

/**
 * The same walk, keyed by package `name` and carrying the whole manifest.
 *
 * `listWorkspacePackageNames` is now a projection of this, rather than a second traversal, because
 * HARNESS-2660's guard needs each package's `scripts` block and a second walk would be a second
 * answer to "which packages are in this workspace" — the exact fork this module's docstring says it
 * exists to prevent.
 */
export function readWorkspaceManifests(root = WORKSPACE_ROOT) {
  const manifests = new Map();
  const addManifest = (pkgPath) => {
    if (!existsSync(pkgPath)) return;
    const manifest = readJson(pkgPath);
    if (typeof manifest.name === 'string') manifests.set(manifest.name, manifest);
  };
  addManifest(path.join(root, 'package.json'));
  for (const dir of listManifestPackageDirs(root)) addManifest(path.join(dir, 'package.json'));
  for (const dir of listAppDirs(root)) addManifest(path.join(dir, 'package.json'));
  return manifests;
}

export async function findWorkspaceRefFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'workspace-refs',
    why: 'Resolution is relative to the workspace package set; with none, every reference is unresolvable and none is reported.',
  });
  const findings = [];
  const packageJsonFiles = listPackageJsonFiles(root);

  const workspaceNames = listWorkspacePackageNames(root);

  function checkText(text, relativeFile, { allowExamples = false, prose = false } = {}) {
    for (const match of text.matchAll(TOKEN_PATTERN)) {
      const token = match[0];
      if (allowExamples && EXAMPLE_TOKEN_ALLOWLIST.has(token)) continue;
      if (prose && token === GROUP_CONTAINER_NAME) continue; // group-container heading
      if (prose && PLACEHOLDER_NAMES.has(token.slice(token.lastIndexOf('/') + 1))) continue;
      if (!isConcreteName(text, match)) continue;
      if (!workspaceNames.has(token)) {
        findings.push({
          file: relativeFile,
          type: 'unresolved-workspace-ref',
          detail: `${token} does not resolve to any workspace package.`,
        });
      }
    }
  }

  function checkDocumentLine(line, rel, { prose = false } = {}) {
    const commandAt = line.search(/\bpnpm\b.*(?:--filter|-F)\b/);
    if (commandAt < 0) {
      checkText(line, rel, { prose });
      return;
    }
    checkText(line.slice(0, commandAt), rel, { prose });
    const command = line.slice(commandAt);
    const occurrences = filterScriptOccurrences(command);
    if (occurrences.length > 0) {
      for (const occurrence of occurrences)
        for (const name of occurrence.packages) checkText(name, rel);
      return;
    }
    // A bare filter still names a package even if no script follows it yet.
    for (const match of command.matchAll(/(?:--filter|-F)(?:=|[ \t]+)(['"]?)([^\s`'";]+)\1/g))
      checkText(match[2], rel);
  }

  // ANTI-ROT (HARNESS-052): an allowlist entry naming a package that DOES resolve is stale by
  // construction — it exempts nothing today and silently exempts a real ghost the day that package
  // is deleted. `@robota-sdk/agent-provider-bytedance` sat here as "not a workspace package" while
  // being one; the entry was inert, and inert is exactly how a suppression survives review.
  for (const token of EXAMPLE_TOKEN_ALLOWLIST) {
    if (workspaceNames.has(token)) {
      findings.push({
        file: path.relative(root, import.meta.filename),
        type: 'stale-allowlist-entry',
        detail: `${token} is allowlisted as a non-workspace token but resolves to a real workspace package. Remove the entry.`,
      });
    }
  }

  examinedManifests = 0;
  for (const pkgPath of packageJsonFiles) {
    examinedManifests++;
    checkText(readFileSync(pkgPath, 'utf8'), path.relative(root, pkgPath));
  }

  const helperScripts = new Set(listHelperScripts(root));
  examinedHelperScripts = 0;
  for (const scriptPath of helperScripts) {
    examinedHelperScripts++;
    checkText(readFileSync(scriptPath, 'utf8'), path.relative(root, scriptPath), {
      allowExamples: true,
    });
  }

  const referenceFiles = listReferenceFiles(root);
  examinedReferenceFiles = 0;
  examinedReleaseFiles = 0;
  for (const filePath of referenceFiles) {
    if (!['.md', '.mmd'].includes(path.extname(filePath))) continue;
    const rel = path.relative(root, filePath);
    const normalized = rel.split(path.sep).join('/');
    const text = readFileSync(filePath, 'utf8');
    if (normalized.startsWith('.changeset/') && normalized.endsWith('.md')) {
      examinedReleaseFiles += 1;
      checkText(changesetHeader(text), rel); // only the package keys are live
      continue;
    }
    if (isImmutableHistoricalRecord(rel)) continue;
    examinedReferenceFiles += 1;
    if (normalized.endsWith('.mmd')) {
      for (const line of text.split('\n')) if (!ABSENCE_VOCABULARY.test(line)) checkText(line, rel);
      continue;
    }
    let inFence = false;
    for (const line of text.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (ABSENCE_VOCABULARY.test(line)) continue;
      if (inFence) {
        if (/\bpnpm\b.*(?:--filter|-F)\b/.test(line)) checkDocumentLine(line, rel);
        continue;
      }
      const visible = line.replace(/`[^`]*`/g, (span) => {
        if (/\bpnpm\b.*(?:--filter|-F)\b/.test(span)) {
          checkDocumentLine(span, rel);
          return ' ';
        }
        return FRONT_DOOR_DOCS.has(rel) ? span : ' ';
      });
      checkDocumentLine(visible, rel, { prose: true });
    }
  }

  examinedSourceFiles = 0;
  for (const filePath of referenceFiles) {
    if (!SOURCE_EXTENSIONS.includes(path.extname(filePath))) continue;
    if (/\.(?:test|spec)\./.test(path.basename(filePath))) continue;
    if (helperScripts.has(filePath)) continue;
    const rel = path.relative(root, filePath);
    if (isImmutableHistoricalRecord(rel)) continue;
    examinedSourceFiles += 1;
    for (const line of commentLines(readFileSync(filePath, 'utf8')))
      if (!ABSENCE_VOCABULARY.test(line) && /\bpnpm\b.*(?:--filter|-F)\b/.test(line))
        checkDocumentLine(line, rel);
  }

  const preJson = path.join(root, '.changeset', 'pre.json');
  if (existsSync(preJson)) {
    examinedReleaseFiles += 1;
    checkText(
      Object.keys(readJson(preJson).initialVersions ?? {}).join('\n'),
      '.changeset/pre.json',
    );
  }

  return findings;
}

/**
 * How much the last run read — HARNESS-057. Each holder measures its own subject:
 * manifests, helper scripts, live Markdown/diagrams, source comments, and release inputs.
 */
let examinedManifests = 0;
let examinedHelperScripts = 0;
let examinedReferenceFiles = 0;
let examinedSourceFiles = 0;
let examinedReleaseFiles = 0;

/** What the last run actually read — exported so both counts can be asserted. */
export function examinedManifestCount() {
  return examinedManifests;
}
export function examinedHelperScriptCount() {
  return examinedHelperScripts;
}
export function examinedReferenceFileCount() {
  return examinedReferenceFiles;
}
export function examinedSourceFileCount() {
  return examinedSourceFiles;
}
export function examinedReleaseFileCount() {
  return examinedReleaseFiles;
}

export async function main() {
  const findings = await findWorkspaceRefFindings(WORKSPACE_ROOT);
  process.stdout.write(`::examined:: ${examinedManifests} package manifests\n`);
  process.stdout.write(`::examined:: ${examinedHelperScripts} helper scripts\n`);
  if (examinedReferenceFiles > 0)
    process.stdout.write(
      `::examined:: ${examinedReferenceFiles} live Markdown and diagram files\n`,
    );
  if (examinedSourceFiles > 0)
    process.stdout.write(`::examined:: ${examinedSourceFiles} source files for command comments\n`);
  if (examinedReleaseFiles > 0)
    process.stdout.write(`::examined:: ${examinedReleaseFiles} release inputs\n`);
  if (findings.length === 0) {
    process.stdout.write('workspace ref scan passed.\n');
    return;
  }
  process.stdout.write('workspace ref scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
