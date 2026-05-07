#!/usr/bin/env node

/**
 * Check SDK public export layering so lower-package owners do not become hidden
 * top-level SDK contracts by accident.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
const SDK_SRC_DIR = 'packages/agent-sdk/src';
const SDK_TOP_LEVEL_ENTRY = 'packages/agent-sdk/src/index.ts';
const SDK_RUNTIME_FACADE_FILES = new Set([
  'packages/agent-sdk/src/background-tasks/index.ts',
  'packages/agent-sdk/src/subagents/index.ts',
]);
const FORBIDDEN_TOP_LEVEL_OWNER_PACKAGES = [
  '@robota-sdk/agent-core',
  '@robota-sdk/agent-sessions',
  '@robota-sdk/agent-tools',
];

function isForbiddenTopLevelOwnerPackage(source) {
  return FORBIDDEN_TOP_LEVEL_OWNER_PACKAGES.some(
    (ownerPackage) => source === ownerPackage || source.startsWith(`${ownerPackage}/`),
  );
}

function extractReExportDeclarations(content) {
  return [
    ...content.matchAll(
      /\bexport\s+(?:type\s+)?(?:\*|\*\s+as\s+\w+|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g,
    ),
  ].map((match) => ({
    statement: match[0],
    source: match[1],
  }));
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkTypeScriptFiles(root, relativeDir) {
  const dir = path.join(root, relativeDir);
  if (!(await pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relativeDir, entry.name);
    if (child.includes('/dist/') || child.includes('/__tests__/')) continue;
    if (entry.isDirectory()) {
      files.push(...(await walkTypeScriptFiles(root, child)));
      continue;
    }
    if (entry.isFile() && child.endsWith('.ts')) {
      files.push(child);
    }
  }
  return files;
}

function findExportStarFindings(file, content) {
  return extractReExportDeclarations(content)
    .filter((declaration) => /^\s*export\s+(?:type\s+)?\*/.test(declaration.statement))
    .map(() => ({
      file,
      type: 'sdk-public-export-star',
      detail:
        'agent-sdk public barrels must use explicit named exports so owner boundaries are auditable.',
    }));
}

function findTopLevelOwnerPassThroughFindings(file, content) {
  if (file !== SDK_TOP_LEVEL_ENTRY) return [];
  return extractReExportDeclarations(content)
    .filter((declaration) => isForbiddenTopLevelOwnerPackage(declaration.source))
    .map((declaration) => ({
      file,
      type: 'sdk-top-level-owner-pass-through',
      detail: `Top-level agent-sdk must not pass through ${declaration.source}; import from the owning package or add an explicit SDK-owned facade.`,
    }));
}

function findUnexpectedRuntimeFacadeFindings(file, content) {
  if (SDK_RUNTIME_FACADE_FILES.has(file)) return [];
  return extractReExportDeclarations(content)
    .filter((declaration) => declaration.source === '@robota-sdk/agent-runtime')
    .map(() => ({
      file,
      type: 'sdk-runtime-facade-location',
      detail:
        'agent-runtime public re-exports must stay in SDK runtime facade barrels, not arbitrary SDK files.',
    }));
}

export async function findSdkPublicSurfaceFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  for (const file of await walkTypeScriptFiles(root, SDK_SRC_DIR)) {
    const content = await fs.readFile(path.join(root, file), 'utf8');
    findings.push(...findExportStarFindings(file, content));
    findings.push(...findTopLevelOwnerPassThroughFindings(file, content));
    findings.push(...findUnexpectedRuntimeFacadeFindings(file, content));
  }
  return findings;
}

async function main() {
  const findings = await findSdkPublicSurfaceFindings();
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[${finding.type}] ${finding.file}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('sdk public surface scan passed.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
