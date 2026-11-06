import { runSubagentWorkerMain } from '@robota-sdk/agent-subagent-runner';
import { createTestProductRuntime } from '../../../__tests__/helpers/product-runtime.ts';
import { createProductSubagentComposition } from '../../subagent-composition.ts';

const runtime = createTestProductRuntime('test-product', { HOME: process.env.HOME });
const providers = [
  {
    type: 'openai',
    createProvider: () => ({
      name: 'openai',
      chat: async () => ({
        role: 'assistant',
        content: 'project fork child replied',
        timestamp: new Date(),
      }),
    }),
  },
];
runSubagentWorkerMain(createProductSubagentComposition(runtime, () => [], providers));
