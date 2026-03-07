import path from 'node:path';

import {
  WORKSPACE_ROOT,
  hasCanonicalSpecReference,
  listWorkspaceScopes,
  pathExists,
  readText,
} from './shared.mjs';

async function main() {
  const scopes = await listWorkspaceScopes();
  const missingSpec = [];
  const missingIndex = [];
  const missingIndexReference = [];

  for (const scope of scopes) {
    const specPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'docs', 'SPEC.md');
    const indexPath = path.join(WORKSPACE_ROOT, scope.relativeDir, 'docs', 'README.md');

    if (!(await pathExists(specPath))) {
      missingSpec.push(scope.relativeDir);
      continue;
    }

    if (!(await pathExists(indexPath))) {
      missingIndex.push(scope.relativeDir);
      continue;
    }

    const indexContent = await readText(indexPath);
    if (!hasCanonicalSpecReference(indexContent)) {
      missingIndexReference.push(scope.relativeDir);
    }
  }

  const specCoverage = scopes.length === 0 ? 100 : ((scopes.length - missingSpec.length) / scopes.length) * 100;
  const indexCoverage = scopes.length === 0 ? 100 : ((scopes.length - missingIndex.length) / scopes.length) * 100;
  const indexReferenceCoverage = scopes.length === 0
    ? 100
    : ((scopes.length - missingIndexReference.length) / scopes.length) * 100;

  process.stdout.write(`workspace_scopes=${scopes.length}\n`);
  process.stdout.write(`with_spec=${scopes.length - missingSpec.length}\n`);
  process.stdout.write(`without_spec=${missingSpec.length}\n`);
  process.stdout.write(`spec_coverage=${specCoverage.toFixed(1)}%\n`);
  process.stdout.write(`with_docs_index=${scopes.length - missingIndex.length}\n`);
  process.stdout.write(`without_docs_index=${missingIndex.length}\n`);
  process.stdout.write(`docs_index_coverage=${indexCoverage.toFixed(1)}%\n`);
  process.stdout.write(`with_spec_reference_in_index=${scopes.length - missingIndexReference.length}\n`);
  process.stdout.write(`without_spec_reference_in_index=${missingIndexReference.length}\n`);
  process.stdout.write(`index_spec_reference_coverage=${indexReferenceCoverage.toFixed(1)}%\n`);

  if (missingSpec.length === 0 && missingIndex.length === 0 && missingIndexReference.length === 0) {
    process.stdout.write('spec coverage audit passed.\n');
    return;
  }

  if (missingSpec.length > 0) {
    process.stdout.write('missing docs/SPEC.md:\n');
    for (const item of missingSpec) {
      process.stdout.write(`- ${item}\n`);
    }
  }

  if (missingIndex.length > 0) {
    process.stdout.write('missing docs/README.md:\n');
    for (const item of missingIndex) {
      process.stdout.write(`- ${item}\n`);
    }
  }

  if (missingIndexReference.length > 0) {
    process.stdout.write('docs/README.md missing canonical `SPEC.md` reference:\n');
    for (const item of missingIndexReference) {
      process.stdout.write(`- ${item}\n`);
    }
  }
  process.exitCode = 1;
}

void main();
