import { resolveScenarioRecord } from './scenario-owner-map.mjs';
import {
  detectChangedFiles,
  listWorkspaceScopes,
  mapFilesToScopes,
  parseScopeArgs,
  resolveRequestedScopes,
  runCommand,
} from './shared.mjs';

function renderFiles(files) {
  if (files.length === 0) {
    return 'explicit scope';
  }
  return files.join(', ');
}

async function main() {
  const options = parseScopeArgs(process.argv.slice(2));
  const scopes = await listWorkspaceScopes();
  const changedFiles = detectChangedFiles();
  const scopeFiles = mapFilesToScopes(changedFiles, scopes);
  const selectedScopes = options.scopeTokens.length > 0
    ? resolveRequestedScopes(options.scopeTokens, scopes)
    : scopes.filter((scope) => (scopeFiles.get(scope.relativeDir) ?? []).length > 0);

  if (selectedScopes.length === 0) {
    process.stdout.write('No package or app scope detected from changed files.\n');
    process.stdout.write('Use --scope <packages/foo|apps/bar> to run explicit scenario recording.\n');
    return;
  }

  const summary = [];

  for (const scope of selectedScopes) {
    const files = scopeFiles.get(scope.relativeDir) ?? [];
    const scenarioRecording = resolveScenarioRecord(scope);

    process.stdout.write(`\n[record] ${scope.relativeDir}\n`);
    process.stdout.write(`files: ${renderFiles(files)}\n`);

    const records = [];
    const notes = [];

    if (scenarioRecording) {
      for (const command of scenarioRecording.commands) {
        runCommand(command.command, command.args, command.workdir, options.dryRun, command.env);
        records.push(command.label);
      }
    } else {
      notes.push('no owner scenario:record command is registered for this scope');
    }

    summary.push({
      scope: scope.relativeDir,
      records,
      notes,
    });
  }

  process.stdout.write('\nRecording summary:\n');
  for (const item of summary) {
    process.stdout.write(`- ${item.scope}: ${item.records.join(', ') || 'no runnable record commands'}\n`);
    for (const note of item.notes) {
      process.stdout.write(`  note: ${note}\n`);
    }
  }
}

void main();
