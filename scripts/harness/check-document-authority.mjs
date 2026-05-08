#!/usr/bin/env node

/**
 * Warn when changed documentation appears to put durable contracts in the wrong owner document.
 *
 * This first pass is intentionally advisory. Markdown intent is hard to classify without review, so
 * the script reports high-signal warnings and exits successfully.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
const DEFAULT_BASE_REF = 'origin/develop';

const ARCHITECTURE_PLAN_HEADINGS =
  /^##\s+(?:Implementation Plan|Work Plan|Promotion Path|Suggested Backlog Slices|Recommended Direction)\s*$/im;
const DESIGN_CONTRACT_HEADINGS =
  /^##\s+(?:Public API|Package Boundary|Contract|Owner Contract)\s*$/im;

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isMarkdown(filePath) {
  return filePath.endsWith('.md') || filePath.endsWith('.mdx');
}

function isArchitectureDoc(filePath) {
  return (
    filePath === '.agents/specs/ARCHITECTURE-MAP.md' ||
    filePath.startsWith('.agents/specs/architecture-map/') ||
    /^packages\/[^/]+\/docs\/ARCHITECTURE-MAP\.md$/.test(filePath)
  );
}

function isDesignDoc(filePath) {
  return (
    filePath.startsWith('.design/') ||
    /^docs\/plans\/.+-design\.md$/.test(filePath) ||
    /^docs\/superpowers\/.*design.*\.md$/.test(filePath)
  );
}

function isPackageSpec(filePath) {
  return /^(?:packages|apps)\/[^/]+\/docs\/SPEC\.md$/.test(filePath);
}

function getPackageScope(filePath) {
  const match = /^(packages|apps)\/([^/]+)\//.exec(filePath);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function getChangedFiles(baseRef = DEFAULT_BASE_REF) {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`],
      {
        cwd: WORKSPACE_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return output
      .split(/\r?\n/)
      .map((filePath) => filePath.trim())
      .filter(Boolean)
      .map(normalizePath);
  } catch {
    return [];
  }
}

function hasMatchingOwnerDocument(filePath, changedFileSet) {
  const scope = getPackageScope(filePath);
  if (!scope) {
    return false;
  }

  return (
    changedFileSet.has(`${scope}/docs/SPEC.md`) ||
    changedFileSet.has('.agents/specs/ARCHITECTURE-MAP.md') ||
    [...changedFileSet].some((changedFile) =>
      changedFile.startsWith('.agents/specs/architecture-map/'),
    )
  );
}

async function readIfExists(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

export async function findDocumentAuthorityFindings({
  root = WORKSPACE_ROOT,
  changedFiles = getChangedFiles(),
} = {}) {
  const findings = [];
  const normalizedFiles = changedFiles.map(normalizePath);
  const changedFileSet = new Set(normalizedFiles);

  for (const file of normalizedFiles) {
    if (!isMarkdown(file)) {
      continue;
    }
    const content = await readIfExists(root, file);
    if (content === undefined) {
      continue;
    }

    if (isArchitectureDoc(file) && ARCHITECTURE_PLAN_HEADINGS.test(content)) {
      findings.push({
        file,
        type: 'architecture-doc-plan-content',
        detail:
          'Architecture documents own stable boundaries; move implementation plans, recommendations, and promotion paths to design/task/backlog documents.',
      });
    }

    if (
      isDesignDoc(file) &&
      DESIGN_CONTRACT_HEADINGS.test(content) &&
      !hasMatchingOwnerDocument(file, changedFileSet)
    ) {
      findings.push({
        file,
        type: 'design-contract-without-owner-doc',
        detail:
          'Design documents may explain contracts, but accepted contract authority must also appear in the owner SPEC/API/architecture document.',
      });
    }
  }

  for (const file of normalizedFiles) {
    if (!/^(packages|apps)\/[^/]+\/(?:src|package\.json)/.test(file)) {
      continue;
    }
    if (isPackageSpec(file) || hasMatchingOwnerDocument(file, changedFileSet)) {
      continue;
    }
    findings.push({
      file,
      type: 'package-change-without-owner-spec',
      detail:
        'Package source or metadata changed without a matching owner SPEC or architecture-map change in this branch.',
    });
  }

  return findings;
}

export async function main() {
  const findings = await findDocumentAuthorityFindings();
  if (findings.length === 0) {
    process.stdout.write('document authority scan passed.\n');
    return;
  }

  process.stdout.write('document authority scan warnings:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
