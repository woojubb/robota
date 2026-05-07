import { promises as fs } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = process.cwd();

const REQUIRED_MARKERS = [
  {
    file: '.agents/rules/git-branch.md',
    markers: [
      '### Worktree Operating Contract',
      'git worktree add -b <branch> /tmp/robota-<topic> origin/develop',
      'git worktree remove /tmp/robota-<topic>',
      'git worktree prune',
      'Do not switch protected branches inside task worktrees.',
    ],
  },
  {
    file: '.agents/skills/branch-guard/SKILL.md',
    markers: [
      'Worktree operating procedure',
      'git worktree list --porcelain',
      'git worktree add -b <branch> /tmp/robota-<topic> origin/develop',
      'git worktree remove /tmp/robota-<topic>',
      'gh pr view <number> --json state,mergedAt,mergeCommit',
    ],
  },
  {
    file: '.agents/rules/verification.md',
    markers: ['Delete-only pushes', 'tree-equivalent pushes'],
  },
  {
    file: '.agents/skills/repo-change-loop/SKILL.md',
    markers: ['Skip verification for Git operations that publish no repository content'],
  },
  {
    file: 'scripts/harness/pre-push-updates.mjs',
    markers: ['isDeletedRefUpdate', 'decidePrePushVerification'],
  },
  {
    file: 'scripts/harness/pre-push.mjs',
    markers: ['parsePrePushUpdates', 'treeMatchesBase'],
  },
];

async function main() {
  const findings = [];

  for (const requirement of REQUIRED_MARKERS) {
    const targetPath = path.join(WORKSPACE_ROOT, requirement.file);
    let content = '';
    try {
      content = await fs.readFile(targetPath, 'utf8');
    } catch {
      findings.push({
        file: requirement.file,
        detail: 'Required worktree policy owner file is missing.',
      });
      continue;
    }

    for (const marker of requirement.markers) {
      if (!content.includes(marker)) {
        findings.push({
          file: requirement.file,
          detail: `Missing worktree policy marker: ${marker}`,
        });
      }
    }
  }

  if (findings.length === 0) {
    process.stdout.write('worktree policy scan passed.\n');
    return;
  }

  process.stdout.write('worktree policy scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

void main();
