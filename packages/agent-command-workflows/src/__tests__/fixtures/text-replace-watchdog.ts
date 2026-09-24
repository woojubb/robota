import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { executeWorkflowsRun } from '../../run-command.js';
import { createWorkspaceWorkflowProject } from '../../workflow-project.js';
import * as builtWorkflows from '@robota-sdk/agent-command-workflows';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';

// Observe real worker handshakes/exits without adding a product-only testing API.
let entered = 0;
let exited = 0;
const observed = new Set<EventEmitter>();
const emit = EventEmitter.prototype.emit;
EventEmitter.prototype.emit = function (
  this: EventEmitter,
  event: string | symbol,
  ...args: unknown[]
) {
  const message = args[0];
  if (
    event === 'message' &&
    message !== null &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'entered'
  ) {
    observed.add(this);
    entered++;
    process.stdout.write('worker-entered\n');
  }
  if (event === 'exit' && observed.has(this)) exited++;
  return Reflect.apply(emit, this, [event, ...args]);
};
let downstreamStarts = 0;
let regexCompletions = 0;
const providerExecute = LocalDagRuntimeProvider.prototype.execute;
LocalDagRuntimeProvider.prototype.execute = function (dag, inputs, options) {
  return providerExecute.call(this, dag, inputs, {
    ...options,
    onProgress(event) {
      if (event.nodeId === 'after' && event.type === 'node_start') downstreamStarts++;
      if (event.nodeId === 'regex' && event.type === 'node_complete') regexCompletions++;
      options?.onProgress?.(event);
    },
  });
};
const root = process.argv[2]!;
mkdirSync(root, { recursive: true });
const identity = { repositoryKey: `isolation-test:${root}`, displayPath: root, worktreeRoot: root };
const trusted = { state: 'trusted' as const, generation: 1, grantedAt: '2026-09-24T00:00:00.000Z' };
const access = await new WorkspaceTrustService({
  identityResolver: { resolve: () => identity },
  store: {
    inspect: async () => trusted,
    grant: async () => trusted,
    revoke: async () => ({ state: 'revoked' as const, generation: 2 }),
  },
}).inspect(root);
if (access.status !== 'trusted') throw new Error('Expected trusted test project');
const run =
  process.env.ISOLATION_ARTIFACT_MODE === 'built'
    ? (
        (project) => (file: string) =>
          builtWorkflows.executeWorkflowsRun(file, project)
      )(builtWorkflows.createWorkspaceWorkflowProject(access.authority))
    : (
        (project) => (file: string) =>
          executeWorkflowsRun(file, project)
      )(createWorkspaceWorkflowProject(access.authority));
function workflow(text: string) {
  return {
    dagId: 'regex',
    version: 1,
    status: 'draft',
    nodes: [
      { nodeId: 'input', nodeType: 'input', dependsOn: [], config: { text } },
      {
        nodeId: 'regex',
        nodeType: 'text-replace',
        dependsOn: ['input'],
        timeoutMs: 500,
        config: { search: '^(a+)+$', flags: '', useRegex: true, replacement: 'done' },
      },
      { nodeId: 'after', nodeType: 'text-output', dependsOn: ['regex'], config: {} },
    ],
    edges: [
      { from: 'input', to: 'regex', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      { from: 'regex', to: 'after', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    ],
  };
}
writeFileSync(join(root, 'bad.json'), JSON.stringify(workflow('a'.repeat(28) + '!')));
writeFileSync(join(root, 'good.json'), JSON.stringify(workflow('aaaa')));
let heartbeats = 0;
const heartbeat = setInterval(() => {
  heartbeats++;
}, 10);
process.stdout.write('entered\n');
const failed = await run('bad.json');
const terminatedAtFailure = entered === 1 && exited === 1;
const downstreamAtFailure = downstreamStarts;
const regexCompletedAtFailure = regexCompletions;
const succeeded = await run('good.json');
clearInterval(heartbeat);
process.stdout.write(
  JSON.stringify({
    failed,
    succeeded,
    heartbeats,
    terminatedAtFailure,
    entered,
    exited,
    downstreamAtFailure,
    regexCompletedAtFailure,
  }) + '\n',
);
