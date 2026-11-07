/**
 * agent-executor in a web-only realm: the background task manager running an adopted tool call to
 * completion and cancelling another, and the cron arithmetic that schedules a task.
 */
import {
  BackgroundTaskManager,
  createToolInvocationBackgroundTaskRunner,
  nextScheduledFireOnOrAfter,
} from '@robota-sdk/agent-executor';

const request = (adoptionToken) => ({
  kind: 'tool-invocation',
  label: 'crawl-site',
  mode: 'background',
  parentSessionId: 'session-1',
  depth: 0,
  cwd: '/work',
  toolName: 'crawl-site',
  adoptionToken,
  provenanceOwner: 'mcp',
  serverId: 'server-1',
  sourceName: 'crawl_site',
  permissionMode: 'inherit-allowlist',
});

/** Work a tool body has adopted: a promise that settles when the test says so, and an abort that records why. */
function adoptedWork() {
  const work = { aborted: [] };
  work.settled = new Promise((resolve) => (work.resolve = resolve));
  work.abort = (reason) => {
    work.aborted.push(reason);
    return Promise.resolve();
  };
  return work;
}

export default async function agentExecutor(t) {
  const events = [];
  const runner = createToolInvocationBackgroundTaskRunner();
  const manager = new BackgroundTaskManager({
    runners: [runner],
    eventSink: (event) => events.push(event),
  });

  const done = adoptedWork();
  runner.adopt('token-done', done);
  const completed = await manager.spawn(request('token-done'));
  t.equal('a spawned task is running', completed.status, 'running');
  done.resolve({ success: true, data: 'crawled 42 pages' });
  const result = await manager.wait(completed.id);
  t.equal("the task's output is the tool's text", result.output, 'crawled 42 pages');
  t.equal('the manager records it completed', manager.get(completed.id)?.status, 'completed');
  t.equal(
    'exactly one completion event was emitted',
    events.filter((event) => event.type === 'background_task_completed').length,
    1,
  );

  const cancelled = adoptedWork();
  runner.adopt('token-cancel', cancelled);
  const running = await manager.spawn(request('token-cancel'));
  await manager.cancel(running.id, 'user');
  t.equal('cancelling aborts the adopted work with the reason', cancelled.aborted, ['user']);
  t.equal('the manager records it cancelled', manager.get(running.id)?.status, 'cancelled');

  // Cron arithmetic, with no clock but the date it is handed.
  t.equal(
    'the next quarter-hour fire is computed from the given instant',
    nextScheduledFireOnOrAfter('*/15 * * * *', new Date('2026-01-01T10:07:00Z'))?.toISOString(),
    '2026-01-01T10:15:00.000Z',
  );
}
