function addCheck(checks, check) {
  if (!checks.includes(check)) checks.push(check);
}

export function classifyRepositoryChecks(unmappedFiles, rootManifestChange) {
  const checks = [];

  for (const file of unmappedFiles) {
    if (file.startsWith('.agents/tasks/')) {
      addCheck(checks, 'task-plan-scan');
    } else if (
      file === 'AGENTS.md' ||
      file.startsWith('.agents/rules/') ||
      file.startsWith('.agents/skills/')
    ) {
      addCheck(checks, 'harness-consistency');
      addCheck(checks, 'task-plan-scan');
    } else if (file.startsWith('scripts/harness/') || file.startsWith('.claude/hooks/')) {
      addCheck(checks, 'harness-tests');
      addCheck(checks, 'harness-consistency');
    } else if (file.startsWith('.github/workflows/') || file.startsWith('.husky/')) {
      addCheck(checks, 'harness-tests');
      addCheck(checks, 'harness-consistency');
    } else if (
      file === 'package.json' ||
      file === 'pnpm-workspace.yaml' ||
      file === 'pnpm-lock.yaml'
    ) {
      if (
        file === 'package.json' &&
        rootManifestChange?.changedScriptKeys?.some((key) => key.startsWith('harness:'))
      ) {
        addCheck(checks, 'harness-tests');
      }
      addCheck(checks, 'harness-consistency');
    } else {
      addCheck(checks, 'repository-review');
    }
  }

  return checks;
}
