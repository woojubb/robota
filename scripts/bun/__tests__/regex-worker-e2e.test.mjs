import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseProcessTable,
  regexWorkflow,
  runRegexWorkerE2e,
} from '../../../packages/agent-cli/scripts/e2e-regex-worker.mjs';

// The compiled-binary case needs Bun to run for real (CI's Build Bun jobs). Its verdicts do not: these stand-in
// executables behave as the packaged CLI does for one workflow run, and each broken one must be refused.

/** A stand-in for the packaged CLI, in the way `mode` says the regex worker behaves on the hostile run. */
function fakeCli(mode) {
  return `#!${process.execPath}
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finish = (subtype, result, code) =>
  process.stdout.write(JSON.stringify({ type: 'result', result, subtype }) + '\\n', () => process.exit(code));

if (args[0] === '-e') {
  // The regex worker: the real one is this executable started again with a bootstrap that names boundedRegexReplace.
  setTimeout(() => {}, 120000);
} else if (args[0] === 'trust') {
  process.stdout.write('Workspace trust: trusted\\n');
} else if (args[0] === '--configure-provider') {
  process.stdout.write('saved\\n');
} else if (args[0] === '-p') {
  (async () => {
    const file = args[1].replace('/workflows run ', '');
    const timeoutMs = JSON.parse(readFileSync(file, 'utf8')).nodes[1].timeoutMs;
    if (timeoutMs >= 30000) {
      return finish('success', 'Workflow completed in 5ms.\\nOutputs: {\\n  "regex.text": "robota # workers #"\\n}', 0);
    }
    const refusal = 'Workflow failed (' + (timeoutMs + 20) + 'ms): regex: Task execution timed out after ' + timeoutMs + 'ms';
    const startWorker = (options) =>
      spawn(process.argv[1], ['-e', 'const boundedRegexReplace = 1;'], { stdio: 'ignore', ...options });
    const stopWorker = async (worker) => {
      const gone = new Promise((resolve) => worker.once('exit', resolve));
      worker.kill('SIGKILL');
      await gone;
    };
    if (mode === 'hang') {
      startWorker();
      return setInterval(() => {}, 1000);
    }
    if (mode === 'no-worker') {
      await sleep(timeoutMs);
      return finish('error', refusal, 1);
    }
    if (mode === 'leak') {
      const worker = startWorker({ detached: true });
      worker.unref();
      await sleep(timeoutMs);
      return finish('error', refusal, 1);
    }
    const worker = startWorker();
    await sleep(timeoutMs);
    await stopWorker(worker);
    if (mode === 'silent-pass') return finish('success', 'Workflow completed in 20ms.\\nOutputs: {}', 0);
    if (mode === 'crash') {
      return finish('error', 'Workflow failed (5ms): regex: Isolated regex execution failed', 1);
    }
    return finish('error', refusal, 1);
  })();
}
`;
}

// Small limits keep each case to a few seconds; the checks are the same ones the compiled binary is held to.
const options = { timeoutMs: 600, marginMs: 2500, hostileInput: 'x' };

async function runFake(mode) {
  const directory = mkdtempSync(join(tmpdir(), 'regex-worker-fake-'));
  try {
    const fake = join(directory, `fake-agent-${mode}`);
    writeFileSync(fake, fakeCli(mode));
    chmodSync(fake, 0o755);
    return await runRegexWorkerE2e(fake, options);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('regex worker e2e verdicts', () => {
  it('reads the rows of a process table whose command lines hold line breaks', () => {
    const table = [
      '  101     1 /usr/bin/agent',
      '  202   101 /usr/bin/agent -e',
      'const boundedRegexReplace = 1;',
      '  303     1 /usr/bin/other',
    ].join('\n');
    expect(parseProcessTable(table)).toEqual([
      { pid: 101, ppid: 1, command: '/usr/bin/agent' },
      { pid: 202, ppid: 101, command: '/usr/bin/agent -e\nconst boundedRegexReplace = 1;' },
      { pid: 303, ppid: 1, command: '/usr/bin/other' },
    ]);
  });

  it('writes the node timeout into the regex node the run is bounded by', () => {
    const workflow = regexWorkflow({ text: 't', search: 's', replacement: 'r', timeoutMs: 1234 });
    expect(workflow.nodes.find((node) => node.nodeType === 'text-replace')?.timeoutMs).toBe(1234);
  });

  describe.skipIf(process.platform === 'win32')('against a stand-in executable', () => {
    it('passes one that ends the hostile run in the timeout refusal through a worker it kills', async () => {
      await expect(runFake('ok')).resolves.toMatch(
        /^regex-worker=passed; .*leaked=0; recovery=passed$/u,
      );
    }, 60_000);

    it('refuses a run that hangs while its worker keeps running', async () => {
      await expect(runFake('hang')).rejects.toThrow(/The hostile run hung/u);
    }, 60_000);

    it('refuses a run that ends in a crash instead of the timeout refusal', async () => {
      await expect(runFake('crash')).rejects.toThrow(/did not end as the node's timeout refusal/u);
    }, 60_000);

    it('refuses a run whose hostile regex silently completes', async () => {
      await expect(runFake('silent-pass')).rejects.toThrow(
        /did not end as the node's timeout refusal/u,
      );
    }, 60_000);

    it('refuses a timeout refusal that never had a worker child process', async () => {
      await expect(runFake('no-worker')).rejects.toThrow(/never had a regex worker child process/u);
    }, 60_000);

    it('refuses a run that ends while its worker is still running', async () => {
      await expect(runFake('leak')).rejects.toThrow(/outlived the run/u);
    }, 60_000);
  });
});
