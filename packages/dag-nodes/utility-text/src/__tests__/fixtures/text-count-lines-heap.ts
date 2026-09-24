import { TextCountLinesNodeDefinition } from '../../index.js';

const node = new TextCountLinesNodeDefinition();
const text = '\n'.repeat(12_000_000);
const context = {
  executionRoot: '/test/execution-root',
  dagId: 'dag-1',
  dagRunId: 'run-1',
  taskRunId: 'task-1',
  nodeDefinition: {
    nodeId: 'count',
    nodeType: 'text-count-lines',
    dependsOn: [],
    inputs: [],
    outputs: [],
    config: { skipEmpty: true },
  },
  nodeManifest: {
    nodeType: 'text-count-lines',
    displayName: 'Text Count Lines',
    category: 'Utility',
    inputs: [],
    outputs: [],
  },
  attempt: 1,
  executionPath: [],
  currentTotalCredits: 0,
};

const result = await node.taskHandler.execute({ text }, context as never);
if (!result.ok || result.value.text !== '0') throw new Error('Expected zero non-empty lines');
process.stdout.write('ok\n');
