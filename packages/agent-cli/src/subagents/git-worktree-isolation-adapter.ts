import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  BackgroundTaskError,
  type IPreparedSubagentWorktree,
  type ISubagentWorktreeAdapter,
  type ISubagentWorktreePrepareRequest,
} from '@robota-sdk/agent-sdk';

const WORKTREE_DIR = '.robota/worktrees';
const BRANCH_PREFIX = 'robota';
const GIT_ENCODING = 'utf8';
const SHORT_ID_LENGTH = 8;

export interface IGitWorktreeIsolationAdapterOptions {
  worktreeDir?: string;
  branchPrefix?: string;
}

export function createGitWorktreeIsolationAdapter(
  options?: IGitWorktreeIsolationAdapterOptions,
): ISubagentWorktreeAdapter {
  return new GitWorktreeIsolationAdapter(options);
}

export class GitWorktreeIsolationAdapter implements ISubagentWorktreeAdapter {
  private readonly worktreeDir: string;
  private readonly branchPrefix: string;

  constructor(options: IGitWorktreeIsolationAdapterOptions = {}) {
    this.worktreeDir = options.worktreeDir ?? WORKTREE_DIR;
    this.branchPrefix = options.branchPrefix ?? BRANCH_PREFIX;
  }

  prepare(request: ISubagentWorktreePrepareRequest): IPreparedSubagentWorktree {
    const repoRoot = runGit(request.cwd, ['rev-parse', '--show-toplevel']).trim();
    const shortId = randomUUID().slice(0, SHORT_ID_LENGTH);
    const branchName = `${this.branchPrefix}/${request.jobId}-${shortId}`;
    const worktreeRoot = join(repoRoot, this.worktreeDir);
    const worktreePath = join(worktreeRoot, `${request.jobId}-${shortId}`);
    mkdirSync(worktreeRoot, { recursive: true });
    runGit(repoRoot, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
    return { repoRoot, worktreePath, branchName };
  }

  isClean(worktree: IPreparedSubagentWorktree): boolean {
    return this.getStatus(worktree).trim().length === 0;
  }

  getStatus(worktree: IPreparedSubagentWorktree): string {
    return runGit(worktree.worktreePath, ['status', '--porcelain']);
  }

  remove(worktree: IPreparedSubagentWorktree): void {
    runGit(worktree.repoRoot, ['worktree', 'remove', '--force', worktree.worktreePath]);
    runGit(worktree.repoRoot, ['branch', '-D', worktree.branchName]);
  }
}

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: GIT_ENCODING,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BackgroundTaskError('runner', `git ${args.join(' ')} failed: ${message}`);
  }
}
