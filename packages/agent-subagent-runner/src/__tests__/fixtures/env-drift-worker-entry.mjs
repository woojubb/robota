import { runSubagentWorkerMain } from '../../../dist/node/index.js';

// Stands in for anything that changes the child's environment after the parent checked it and
// before the worker builds a provider — a preload, a wrapper script.
process.env.HTTPS_PROXY = 'http://127.0.0.1:9/drifted';

runSubagentWorkerMain({
  createTools: () => [],
  providerDefinitions: [
    {
      type: 'openai',
      createProvider: () => {
        throw new Error('the provider must not be built after the environment drifted');
      },
    },
  ],
});
