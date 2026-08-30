import { git, sharedGitOptions } from './work-run-git-command.mjs';

export function repositoryNameFromGit(root, options = {}) {
  return git(root, ['config', '--get', 'remote.origin.url'], sharedGitOptions(options))
    .replace(/^.*github\.com[/:]/, '')
    .replace(/\.git$/, '');
}

export function repoContext(root = process.cwd(), options = {}) {
  const gitOptions = sharedGitOptions(options);
  const repositoryRoot = git(root, ['rev-parse', '--show-toplevel'], gitOptions);
  let branch = null;
  try {
    branch = git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'], gitOptions);
  } catch (error) {
    if (error?.status !== 1 && error?.cause?.status !== 1) throw error;
  }
  return {
    root: repositoryRoot,
    branch,
    commonDir: git(
      repositoryRoot,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      gitOptions,
    ),
  };
}

export function lockLocalBranchSubject(root, expectedBranch, options = {}) {
  const gitOptions = sharedGitOptions(options);
  const before = repoContext(root, options);
  if (before.branch !== expectedBranch) {
    throw new Error(`work-run branch changed before mutation: ${before.branch ?? 'detached'}`);
  }
  const headRef = git(
    before.root,
    ['rev-parse', `refs/heads/${expectedBranch}^{commit}`],
    gitOptions,
  );
  const after = repoContext(before.root, options);
  const currentHead = git(after.root, ['rev-parse', 'HEAD^{commit}'], gitOptions);
  if (after.branch !== expectedBranch || currentHead !== headRef) {
    throw new Error('work-run branch or HEAD changed while binding the mutation subject');
  }
  return { branch: expectedBranch, headRef };
}

export function assertLocalBranchSubject(root, subject, options = {}) {
  const gitOptions = sharedGitOptions(options);
  const current = repoContext(root, options);
  const currentHead = git(current.root, ['rev-parse', 'HEAD^{commit}'], gitOptions);
  if (current.branch !== subject.branch || currentHead !== subject.headRef) {
    throw new Error('work-run branch or HEAD changed during mutation');
  }
}
