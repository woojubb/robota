/** Read exact-tag pushes and active manual producers; fail closed if a bounded page is incomplete. */
export async function fetchReleaseRuns(github, owner, repo, workflowId, tag) {
  const request = async (options) => {
    const { data } = await github.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowId,
      per_page: 100,
      ...options,
    });
    if (data.total_count > data.workflow_runs.length)
      throw new Error('Release run search exceeds the bounded page');
    return data.workflow_runs;
  };
  const pages = await Promise.all([
    request({ branch: tag, event: 'push' }),
    ...['queued', 'in_progress', 'waiting', 'requested', 'pending', 'action_required'].map(
      (status) => request({ event: 'workflow_dispatch', status }),
    ),
  ]);
  return pages.flat();
}

/** Exhaust filtered push history by splitting intervals below GitHub's 1,000-run limit. */
export async function fetchAllPushRuns(github, owner, repo, workflowId, earliest) {
  const first = Math.floor(Date.parse(earliest) / 1000);
  const last = Math.floor(Date.now() / 1000) + 1;
  if (!Number.isFinite(first) || first > last) throw new Error('Invalid repository creation time');
  const request = async (start, end, page = 1) =>
    (
      await github.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflowId,
        event: 'push',
        per_page: 100,
        page,
        created: `${new Date(start * 1000).toISOString()}..${new Date(end * 1000).toISOString()}`,
      })
    ).data;
  const collect = async (start, end) => {
    const head = await request(start, end);
    if (head.total_count >= 1000) {
      if (end - start <= 1) throw new Error('Release history exceeds the per-second search limit');
      const middle = Math.floor((start + end) / 2);
      return [...(await collect(start, middle)), ...(await collect(middle + 1, end))];
    }
    const runs = [...head.workflow_runs];
    for (let page = 2; runs.length < head.total_count; page += 1) {
      const data = await request(start, end, page);
      if (!data.workflow_runs.length) throw new Error('Incomplete release run history');
      runs.push(...data.workflow_runs);
    }
    if (runs.length !== head.total_count) throw new Error('Inconsistent release run history');
    return runs;
  };
  return collect(first, last);
}
