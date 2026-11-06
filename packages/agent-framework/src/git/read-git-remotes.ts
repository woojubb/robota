import { execFileInChildSession } from '@robota-sdk/agent-core/node';

const GIT_REMOTE_TIMEOUT_MS = 2_000;

/**
 * The remotes `cwd`'s repository has, as the permission classifier is told them; none when `cwd` is
 * not a repository or git cannot run.
 *
 * Runs `git` with the whole environment of this process on purpose, unlike `createGitProcess`, which
 * strips `GIT_DIR` and `GIT_WORK_TREE`: a `git push` the classifier judges runs with that
 * environment, so the remotes it is told must be the ones that push would reach.
 */
export function readNodeGitRemotes(cwd: string): Promise<string[]> {
  return new Promise((resolve) => {
    // git from PATH, in its own session in secure mode.
    execFileInChildSession(
      'git',
      ['remote', '-v'],
      { cwd, timeout: GIT_REMOTE_TIMEOUT_MS },
      (error, stdout) => {
        // allow-fallback: no git, or not a repository, means no remote is trusted
        if (error !== null) return resolve([]);
        const urls = stdout
          .split('\n')
          .map((line) => line.split(/\s+/)[1])
          .filter((url): url is string => url !== undefined && url.length > 0);
        resolve([...new Set(urls)]);
      },
    );
  });
}
