/** Resolve the branch identity that the detached dist-free scan must continue to validate. */
export function resolveDistFreeSubject(env, gitRunner) {
  const subjectSha = env.PR_HEAD_SHA?.trim() || gitRunner(['rev-parse', 'HEAD^{commit}']).trim();
  const subjectBranch =
    env.GITHUB_HEAD_REF?.trim() || gitRunner(['symbolic-ref', '--quiet', '--short', 'HEAD']).trim();
  return { subjectSha, subjectBranch };
}

/** Run the detached scan while preserving the identity of the original checked-out subject. */
export function runWithDistFreeSubject(run, args, cwd, env, gitRunner) {
  const { subjectSha, subjectBranch } = resolveDistFreeSubject(env, gitRunner);
  return run('node', args, cwd, {
    env: { ...env, PR_HEAD_SHA: subjectSha, GITHUB_HEAD_REF: subjectBranch },
  });
}
