/**
 * ARCH-021 TC-01: a composition-root stand-in that enters the REAL worker entry point.
 *
 * The bintest asserts what robota composes, but `composedToolNames` is computed from the composition
 * independently of `runInitialPrompt` — so reverting `parentTools:` to an empty array, or building
 * the tools at the parent's cwd instead of `subagentExecutionRoot(payload)`, leaves that test green.
 * This entry closes that gap: its `createTools` RECORDS the cwd it is called with, so a test can
 * observe the root the worker actually asked for, on the real code path.
 *
 * Deliberately not a hand-rolled worker: the existing fixture never enters `runSubagentWorkerMain`,
 * which is exactly the function ARCH-021 changed.
 */
import { appendFileSync } from 'node:fs';

import { runSubagentWorkerMain } from '../../../dist/node/index.js';

const RECORD_PATH = process.env.ARCH_021_RECORD_PATH;
const SCRATCH_TOOL_NAME = 'arch021ScratchTool';

function record(event) {
  if (!RECORD_PATH) return;
  appendFileSync(RECORD_PATH, `${JSON.stringify(event)}\n`, 'utf8');
}

runSubagentWorkerMain({
  createTools: ({ cwd }) => {
    // The observation the whole fixture exists for: WHICH root the worker asked for, and when.
    record({ createToolsCwd: cwd });
    return [
      {
        schema: { name: SCRATCH_TOOL_NAME, description: 'scratch', parameters: {} },
        getName: () => SCRATCH_TOOL_NAME,
        execute: () => Promise.resolve({ success: true, data: 'scratch' }),
      },
    ];
  },
  // A provider type no default registry contains. If the worker still built from
  // `createDefaultProviderDefinitions()`, resolving this would throw `Unknown provider`.
  providerDefinitions: [
    {
      type: 'arch021-scratch-provider',
      createProvider: () => {
        record({ createProvider: true });
        return {
          name: 'arch021-scratch-provider',
          chat: () =>
            Promise.resolve({ role: 'assistant', content: 'scratch', timestamp: new Date() }),
        };
      },
    },
  ],
});
