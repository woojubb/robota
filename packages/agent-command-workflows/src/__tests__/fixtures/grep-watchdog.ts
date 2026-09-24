import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { executeWorkflowsRun } from '../../run-command.js';
import { createWorkflowProjectFixture } from '../workflow-project-fixture.js';

const root = process.argv[2]!;
let terminations = 0;
let exits = 0;
const terminate = Worker.prototype.terminate;
Worker.prototype.terminate = function (this: Worker): Promise<number> {
  terminations++;
  this.once('exit', () => { exits++; });
  return terminate.call(this);
};
writeFileSync(join(root, 'input.txt'), `${'a'.repeat(32)}!\n`);
const project = await createWorkflowProjectFixture(root);
function workflow(pattern: string) {
  return {
    dagId: 'grep-watchdog',
    version: 1,
    status: 'draft',
    nodes: [
      {
        nodeId: 'grep',
        nodeType: 'tool',
        dependsOn: [],
        timeoutMs: 500,
        config: { toolName: 'grep', params: { pattern, path: 'input.txt', outputMode: 'count' } },
      },
    ],
    edges: [],
  };
}
writeFileSync(join(root, 'bad.json'), JSON.stringify(workflow('^(a+)+$')));
writeFileSync(join(root, 'good.json'), JSON.stringify(workflow('!')));
let heartbeats = 0;
const heartbeat = setInterval(() => {
  heartbeats++;
}, 10);
process.stdout.write('entered\n');
const failed = await executeWorkflowsRun('bad.json', project);
const terminatedAtFailure = terminations > 0 && exits === terminations;
const succeeded = await executeWorkflowsRun('good.json', project);
clearInterval(heartbeat);
process.stdout.write(JSON.stringify({ failed, succeeded, heartbeats, terminatedAtFailure }) + '\n');
