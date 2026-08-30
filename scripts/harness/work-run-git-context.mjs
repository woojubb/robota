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
