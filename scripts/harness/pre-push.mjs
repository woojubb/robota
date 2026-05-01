import { spawnSync } from 'node:child_process';

import { resolveGitBaseRef, WORKSPACE_ROOT } from './shared.mjs';

function run(command, args) {
  const rendered = [command, ...args].join(' ');
  process.stdout.write(`> ${rendered}\n`);

  const result = spawnSync(command, args, {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const baseRef = resolveGitBaseRef(process.env.HARNESS_BASE_REF ?? null);
const baseArgs = baseRef ? ['--base-ref', baseRef] : [];

process.stdout.write('▶ scoped pre-push verification\n');
if (baseRef) {
  process.stdout.write(`base: ${baseRef}\n`);
} else {
  process.stdout.write('base: unresolved; using working-tree changes only\n');
}

run('pnpm', ['harness:plan', '--', ...baseArgs]);
run('pnpm', ['harness:verify', '--', ...baseArgs, '--skip-record-check']);

process.stdout.write('\nRelease-grade verification remains explicit:\n');
process.stdout.write('  pnpm harness:verify:release\n');
