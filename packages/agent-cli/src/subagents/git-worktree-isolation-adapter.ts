import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  BackgroundTaskError,
  type IPreparedSubagentWorktree,
  type ISubagentWorktreeAdapter,
  type ISubagentWorktreePrepareRequest,
} from '@robota-sdk/agent-executor';

const GIT_ENCODING = 'utf8';
const SHORT_ID_LENGTH = 8;
const DEFAULT_MAX_CREATE_ATTEMPTS = 5;
const COLLISION_ERROR_PATTERN =
  /already exists|is already checked out|missing but already registered/i;

export interface IGitWorktreeIsolationAdapterOptions {
  worktreeDir: string;
  branchPrefix: string;
  environment: Readonly<Record<string, string | undefined>>;
  idFactory?: () => string;
  maxCreateAttempts?: number;
}

export function createGitWorktreeIsolationAdapter(
  options: IGitWorktreeIsolationAdapterOptions,
): ISubagentWorktreeAdapter {
  return new GitWorktreeIsolationAdapter(options);
}

export class GitWorktreeIsolationAdapter implements ISubagentWorktreeAdapter {
  private readonly worktreeDir: string;
  private readonly branchPrefix: string;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly idFactory: () => string;
  private readonly maxCreateAttempts: number;

  constructor(options: IGitWorktreeIsolationAdapterOptions) {
    this.worktreeDir = options.worktreeDir;
    this.branchPrefix = options.branchPrefix;
    this.environment = { ...options.environment };
    this.idFactory = options.idFactory ?? createShortId;
    this.maxCreateAttempts = options.maxCreateAttempts ?? DEFAULT_MAX_CREATE_ATTEMPTS;
  }

  prepare(request: ISubagentWorktreePrepareRequest): IPreparedSubagentWorktree {
    if (this.maxCreateAttempts < 1) {
      throw new BackgroundTaskError('runner', 'Git worktree creation attempts must be at least 1');
    }
    const repoRoot = resolveRepoRoot(request.cwd, this.environment);
    const baseRevision = runGit(repoRoot, ['rev-parse', 'HEAD'], this.environment).trim();
    const parentStatus = runGit(repoRoot, ['status', '--porcelain'], this.environment).trimEnd();
    const worktreeRoot = join(repoRoot, this.worktreeDir);
    mkdirSync(worktreeRoot, { recursive: true });

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxCreateAttempts; attempt += 1) {
      const shortId = normalizeShortId(this.idFactory());
      const taskId = sanitizePathSegment(request.taskId);
      const branchName = `${this.branchPrefix}/${taskId}-${shortId}`;
      const worktreePath = join(worktreeRoot, `${taskId}-${shortId}`);
      try {
        runGit(repoRoot, ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], this.environment);
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
    return runGit(worktree.worktreePath, ['status', '--porcelain'], this.environment);
  }

  remove(worktree: IPreparedSubagentWorktree): void {
    runGit(worktree.repoRoot, ['worktree', 'remove', '--force', worktree.worktreePath], this.environment);
    runGit(worktree.repoRoot, ['branch', '-D', worktree.branchName], this.environment);
  }
}

function runGit(cwd: string, args: string[], environment: Readonly<Record<string, string | undefined>>): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: GIT_ENCODING,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: createGitEnvironment(environment),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BackgroundTaskError('runner', `git ${args.join(' ')} failed: ${message}`);
  }
}

function createGitEnvironment(environment: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const env = { ...environment };
  // Git hooks export GIT_* variables that force child git commands back to the hook repository.
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) {
      delete env[key];
    }
  }
  return env;
}

function resolveRepoRoot(cwd: string, environment: Readonly<Record<string, string | undefined>>): string {
  try {
    return runGit(cwd, ['rev-parse', '--show-toplevel'], environment).trim();
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

/**
 * Remove every leading and trailing `-`, by index scan.
 *
 * Not `replace(/^-+|-+$/g, '')`: the trailing half has no start anchor, so the engine retries the run from every
 * offset inside it and each retry re-scans to the end — 3.1 s on a 100 K dash run (`js/polynomial-redos`,
 * SEC-003). `-` survives the collapse in {@link sanitizePathSegment} (it is inside the kept class), so a long run
 * does reach here.
 */
function trimDashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '-') start += 1;
  while (end > start && value[end - 1] === '-') end -= 1;
  return value.slice(start, end);
}

function sanitizePathSegment(value: string): string {
  const sanitized = trimDashes(value.replace(/[^A-Za-z0-9._-]+/g, '-'));
  return sanitized.length > 0 ? sanitized : 'agent';
}

function toError<TError>(error: TError): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isCollisionError(error: Error): boolean {
  return COLLISION_ERROR_PATTERN.test(error.message);
}
