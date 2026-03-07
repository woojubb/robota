import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listWorkspaceScopes, WORKSPACE_ROOT } from './harness/shared.mjs';

const MARKDOWN_EXTENSION = '.md';
const ROOT_DOCS_BASENAMES = new Set(['README.md', 'CHANGELOG.md']);
const DOCS_INDEX_BASENAME = 'README.md';
const UPPERCASE_DOCS_FILENAME_PATTERN = /^[A-Z0-9-]+\.md$/;

async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function getDirectoryEntries(targetPath) {
    return fs.readdir(targetPath, { withFileTypes: true });
}

function isAllowedRootDocFile(fileName) {
    return ROOT_DOCS_BASENAMES.has(fileName);
}

function isAllowedDocsFileName(fileName) {
    if (fileName === DOCS_INDEX_BASENAME) {
        return true;
    }
    return UPPERCASE_DOCS_FILENAME_PATTERN.test(fileName);
}

async function validatePackageDocumentation(packagePath) {
    const violations = [];
    const relativePackagePath = path.relative(WORKSPACE_ROOT, packagePath);
    const docsPath = path.join(packagePath, 'docs');
    const hasDocsDirectory = await pathExists(docsPath);

    const packageEntries = await getDirectoryEntries(packagePath);
    for (const entry of packageEntries) {
        if (!entry.isFile() || !entry.name.endsWith(MARKDOWN_EXTENSION)) {
            continue;
        }
        if (!isAllowedRootDocFile(entry.name)) {
            violations.push(
                `[root-docs] ${path.join(relativePackagePath, entry.name)} is not allowed. Use docs/ for package docs; only README.md and CHANGELOG.md are allowed at package root.`
            );
        }
    }

    if (!hasDocsDirectory) {
        return violations;
    }

    const docsEntries = await getDirectoryEntries(docsPath);
    const hasDocsIndex = docsEntries.some((entry) => entry.isFile() && entry.name === DOCS_INDEX_BASENAME);
    if (!hasDocsIndex) {
        violations.push(`[docs-index] ${path.join(relativePackagePath, 'docs', DOCS_INDEX_BASENAME)} is required.`);
    }

    for (const entry of docsEntries) {
        if (!entry.isFile() || !entry.name.endsWith(MARKDOWN_EXTENSION)) {
            continue;
        }
        if (!isAllowedDocsFileName(entry.name)) {
            violations.push(
                `[docs-name] ${path.join(relativePackagePath, 'docs', entry.name)} must be README.md or uppercase kebab-case (e.g., SPEC.md, DEVELOPMENT.md, API-REFERENCE.md).`
            );
        }
    }

    return violations;
}

async function main() {
    const packageDirectories = (await listWorkspaceScopes()).map((scope) => path.join(WORKSPACE_ROOT, scope.relativeDir));
    const violations = [];

    for (const packagePath of packageDirectories) {
        const packageViolations = await validatePackageDocumentation(packagePath);
        violations.push(...packageViolations);
    }

    if (violations.length === 0) {
        process.stdout.write('docs structure validation passed.\n');
        return;
    }

    process.stdout.write('docs structure validation failed:\n');
    for (const violation of violations) {
        process.stdout.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
}

void main();
