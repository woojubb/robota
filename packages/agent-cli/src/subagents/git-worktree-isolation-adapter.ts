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
const DEFAULT_MAX_CREATE_ATTEMPTS = 5;
const COLLISION_ERROR_PATTERN =
  /already exists|is already checked out|missing but already registered/i;

export interface IGitWorktreeIsolationAdapterOptions {
  worktreeDir?: string;
  branchPrefix?: string;
  idFactory?: () => string;
  maxCreateAttempts?: number;
}

export function createGitWorktreeIsolationAdapter(
  options?: IGitWorktreeIsolationAdapterOptions,
): ISubagentWorktreeAdapter {
  return new GitWorktreeIsolationAdapter(options);
}

export class GitWorktreeIsolationAdapter implements ISubagentWorktreeAdapter {
  private readonly worktreeDir: string;
  private readonly branchPrefix: string;
  private readonly idFactory: () => string;
  private readonly maxCreateAttempts: number;

  constructor(options: IGitWorktreeIsolationAdapterOptions = {}) {
    this.worktreeDir = options.worktreeDir ?? WORKTREE_DIR;
    this.branchPrefix = options.branchPrefix ?? BRANCH_PREFIX;
    this.idFactory = options.idFactory ?? createShortId;
    this.maxCreateAttempts = options.maxCreateAttempts ?? DEFAULT_MAX_CREATE_ATTEMPTS;
  }

  prepare(request: ISubagentWorktreePrepareRequest): IPreparedSubagentWorktree {
    if (this.maxCreateAttempts < 1) {
      throw new BackgroundTaskError('runner', 'Git worktree creation attempts must be at least 1');
    }
    const repoRoot = resolveRepoRoot(request.cwd);
    const baseRevision = runGit(repoRoot, ['rev-parse', 'HEAD']).trim();
    const parentStatus = runGit(repoRoot, ['status', '--porcelain']).trimEnd();
    const worktreeRoot = join(repoRoot, this.worktreeDir);
    mkdirSync(worktreeRoot, { recursive: true });

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxCreateAttempts; attempt += 1) {
      const shortId = normalizeShortId(this.idFactory());
      const jobId = sanitizePathSegment(request.jobId);
      const branchName = `${this.branchPrefix}/${jobId}-${shortId}`;
      const worktreePath = join(worktreeRoot, `${jobId}-${shortId}`);
      try {
        runGit(repoRoot, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);
        return { repoRoot, worktreePath, branchName, baseRevision, parentStatus };
      } catch (error) {
        lastError = toError(error);
        if (!isCollisionError(lastError)) throw lastError;
      }
    }

    throw new BackgroundTaskError(
      'runner',
      `Unable to create Git worktree after ${this.maxCreateAttempts} attempts due to branch or path collisions. Last error: ${lastError?.message ?? 'unknown error'}`,
    );
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

function resolveRepoRoot(cwd: string): string {
  try {
    return runGit(cwd, ['rev-parse', '--show-toplevel']).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BackgroundTaskError(
      'runner',
      `Worktree isolation requires a Git repository. Run from a Git worktree or request isolation "none". Details: ${message}`,
    );
  }
}

function createShortId(): string {
  return randomUUID().slice(0, SHORT_ID_LENGTH);
}

function normalizeShortId(value: string): string {
  const sanitized = sanitizePathSegment(value).slice(0, SHORT_ID_LENGTH);
  return sanitized.length > 0 ? sanitized : createShortId();
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'agent';
}

function toError<TError>(error: TError): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isCollisionError(error: Error): boolean {
  return COLLISION_ERROR_PATTERN.test(error.message);
}
