import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { selectDesktopRelease, recoveryCandidates } from '../desktop-release-order.mjs';

const makeRun = (name, overrides = {}) => ({
  name,
  id: name === 'native' ? 1 : 2,
  event: 'push',
  head_branch: 'v3.0.3',
  head_sha: 'abc',
  head_repository: { full_name: 'owner/repo' },
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-01-01T00:00:00Z',
  run_attempt: 1,
  ...overrides,
});
const native = makeRun('native');
const desktop = makeRun('desktop');
const event = { repository: 'owner/repo', tag: 'v3.0.3', sha: 'abc' };

test('joins both exact-tag runs in either completion order', () => {
  for (const source of [native, desktop]) {
    assert.equal(selectDesktopRelease(event, source, [native], [desktop]), true);
    assert.equal(selectDesktopRelease(event, source, [native], []), false);
    assert.equal(selectDesktopRelease(event, source, [], [desktop]), false);
  }
});
test('does not mix same-commit tags, forks, failed runs, or verify-only dispatches', () => {
  for (const bad of [
    { head_branch: 'v3.0.2' },
    { head_sha: 'other' },
    { head_repository: { full_name: 'fork/repo' } },
    { conclusion: 'failure' },
    { status: 'in_progress', conclusion: null },
    { event: 'workflow_dispatch' },
    { event: 'pull_request' },
  ])
    assert.equal(selectDesktopRelease(event, native, [native], [makeRun('desktop', bad)]), false);
});
test('does not let an older successful run mask a newer failed run', () => {
  const failed = makeRun('desktop', {
    id: 3,
    conclusion: 'failure',
    created_at: '2026-01-02T00:00:00Z',
  });
  assert.equal(selectDesktopRelease(event, native, [native], [desktop, failed]), false);
});
test('rejects an untrusted completion event', () => {
  assert.equal(
    selectDesktopRelease(event, makeRun('native', { event: 'pull_request' }), [native], [desktop]),
    false,
  );
});
test('waits for any active manual producer that could overwrite release assets', () => {
  const activeManual = makeRun('desktop', {
    id: 4,
    event: 'workflow_dispatch',
    status: 'in_progress',
    conclusion: null,
  });
  assert.equal(selectDesktopRelease(event, native, [native], [desktop, activeManual]), false);
});
test('does not certify while a manual producer is pending', () => {
  const manual = makeRun('desktop', {
    id: 4,
    event: 'workflow_dispatch',
    status: 'pending',
    conclusion: null,
  });
  assert.equal(selectDesktopRelease(event, native, [native], [desktop, manual]), false);
  manual.status = 'completed';
  manual.conclusion = 'success';
  assert.equal(selectDesktopRelease(event, native, [native], [desktop, manual]), true);
});
test('does not certify an old success when a newer release attempt is still running', () => {
  const newer = makeRun('native', {
    id: 5,
    created_at: '2026-01-02T00:00:00Z',
    status: 'in_progress',
    conclusion: null,
  });
  assert.equal(selectDesktopRelease(event, desktop, [native, newer], [desktop]), false);
});
test('re-evaluates exact push tags after a manual producer finishes', () => {
  const manual = makeRun('desktop', {
    id: 4,
    event: 'workflow_dispatch',
    head_branch: 'main',
    status: 'in_progress',
    conclusion: null,
  });
  const candidates = recoveryCandidates(event.repository, [native], [desktop, manual]);
  assert.deepEqual(candidates, [{ tag: event.tag, sha: event.sha }]);
  assert.equal(selectDesktopRelease(event, native, [native], [desktop, manual]), false);
  manual.status = 'completed';
  manual.conclusion = 'success';
  assert.equal(selectDesktopRelease(event, native, [native], [desktop, manual]), true);
});

test('recovery skips a deleted tag without suppressing a valid release', async () => {
  const { resolveReleaseTag } = await import('../desktop-release-order.mjs');
  const github = {
    rest: {
      git: {
        getRef: async ({ ref }) => {
          if (ref === 'tags/old') throw Object.assign(new Error('missing'), { status: 404 });
          return { data: { object: { type: 'commit', sha: 'abc' } } };
        },
      },
    },
  };
  assert.equal(
    await resolveReleaseTag(github, 'owner', 'repo', { tag: 'old', sha: 'abc' }, true),
    false,
  );
  assert.equal(await resolveReleaseTag(github, 'owner', 'repo', event, true), true);
  await assert.rejects(
    resolveReleaseTag(github, 'owner', 'repo', { tag: 'old', sha: 'abc' }, false),
  );
});

test('a failed-only rerun can reuse a matching successful earlier producer artifact', async () => {
  const { selectEvidenceArtifact } = await import('../desktop-release-order.mjs');
  const artifact = { name: 'desktop-release-evidence-42-1', expired: false };
  assert.equal(selectEvidenceArtifact([artifact], 'desktop', 42, 2).attempt, 1);
  const newer = { name: 'desktop-release-evidence-42-2', expired: false };
  assert.equal(selectEvidenceArtifact([artifact, newer], 'desktop', 42, 2).attempt, 2);
  assert.throws(() => selectEvidenceArtifact([newer, newer], 'desktop', 42, 2), /Ambiguous/);
  assert.equal(
    selectEvidenceArtifact([{ ...artifact, expired: true }], 'desktop', 42, 2),
    undefined,
  );
});
