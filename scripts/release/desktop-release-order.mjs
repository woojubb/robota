/** Select the latest exact-tag producer attempts; pending and failed attempts cannot certify delivery. */
export function selectDesktopRelease(expected, trigger, nativeRuns, desktopRuns) {
  const relevant = (run) =>
    run?.event === 'push' &&
    run.head_repository?.full_name === expected.repository &&
    run.head_branch === expected.tag;
  if (!expected.tag || !expected.sha || !relevant(trigger) || trigger.head_sha !== expected.sha)
    return false;
  if (
    [...nativeRuns, ...desktopRuns].some(
      (run) => run.event === 'workflow_dispatch' && run.status !== 'completed',
    )
  )
    return false;
  const latest = (runs) =>
    runs.filter(relevant).sort((a, b) => {
      const time = Date.parse(b.created_at) - Date.parse(a.created_at);
      return time || b.id - a.id;
    })[0];
  const native = latest(nativeRuns);
  const desktop = latest(desktopRuns);
  return Boolean(
    native &&
    desktop &&
    [native, desktop].every(
      (run) =>
        run.status === 'completed' && run.conclusion === 'success' && run.head_sha === expected.sha,
    ) &&
    [native.id, desktop.id].includes(trigger.id),
  );
}

export function latestTagRun(expected, runs) {
  return runs
    .filter(
      (run) =>
        run.event === 'push' &&
        run.head_repository?.full_name === expected.repository &&
        run.head_branch === expected.tag,
    )
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)[0];
}

/** Recover candidates from tag-push history without inferring a tag from a manual run. */
export function recoveryCandidates(repository, nativeRuns, desktopRuns) {
  const candidates = new Map();
  for (const run of [...nativeRuns, ...desktopRuns]) {
    if (
      run.event !== 'push' ||
      run.head_repository?.full_name !== repository ||
      typeof run.head_branch !== 'string' ||
      !/^[A-Za-z0-9._+-]+$/u.test(run.head_branch) ||
      typeof run.head_sha !== 'string' ||
      !run.head_sha
    )
      continue;
    candidates.set(`${run.head_branch}:${run.head_sha}`, {
      tag: run.head_branch,
      sha: run.head_sha,
    });
  }
  return [...candidates.values()];
}

/** Resolve the exact tag, treating stale historical tags as ineligible during recovery. */
export async function resolveReleaseTag(github, owner, repo, expected, recovering) {
  let ref;
  try {
    ref = (await github.rest.git.getRef({ owner, repo, ref: `tags/${expected.tag}` })).data;
  } catch (error) {
    if (error.status === 404 && recovering) return false;
    throw error;
  }
  let object = ref.object;
  if (object.type === 'tag')
    object = (await github.rest.git.getTag({ owner, repo, tag_sha: object.sha })).data.object;
  if (object.type === 'commit' && object.sha === expected.sha) return true;
  if (recovering) return false;
  throw new Error('Tag does not identify the triggering commit');
}

/** A failed-only rerun may reuse a successful producer job from an earlier attempt. */
export function selectEvidenceArtifact(artifacts, kind, runId, currentAttempt) {
  const prefix = `${kind}-release-evidence-${runId}-`;
  const eligible = artifacts
    .flatMap((artifact) => {
      if (artifact.expired || !artifact.name.startsWith(prefix)) return [];
      const suffix = artifact.name.slice(prefix.length);
      if (!/^[1-9][0-9]*$/u.test(suffix)) return [];
      const attempt = Number(suffix);
      return attempt <= currentAttempt ? [{ ...artifact, attempt }] : [];
    })
    .sort((a, b) => b.attempt - a.attempt);
  if (eligible.length > 1 && eligible[0].attempt === eligible[1].attempt)
    throw new Error('Ambiguous release evidence artifacts');
  return eligible[0];
}
