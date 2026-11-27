import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildWorkerContainerArgs, materializeWorkerTree } from './outcome-coding-trial.js';
import { observeTree } from './outcome-coding-verify.js';
import type { ICodingTask } from './outcome-coding-tasks.js';

/**
 * Isolation canaries: probes that run in the worker container with the worker's exact arguments and
 * report what the container can and cannot do. Each reported check must hold; a failed check means
 * the worker's isolation is not what the trial's claims assume.
 */

/** A host environment variable that stands in for a credential; it must never reach the container. */
export const CANARY_ENV_NAME = 'ROBOTA_EVAL_CANARY_SECRET';

const CANARY_SCRIPT = `
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');
const crypto = require('node:crypto');
const hostFile = process.argv[1];
const attempt = (action) => { try { action(); return true; } catch { return false; } };
(async () => {
  const out = {};
  out.nonRoot = process.getuid() === 1000 && process.getgid() === 1000;
  out.environment = Object.entries(process.env).map(([name, value]) => ({
    name, sha256: crypto.createHash('sha256').update(value ?? '').digest('hex'),
  }));
  out.hostPathHidden = !attempt(() => fs.readFileSync(hostFile));
  out.outsideWritesRefused = ['/opt/robota/canary', '/etc/canary', '/usr/canary', '/canary']
    .every((path) => !attempt(() => fs.writeFileSync(path, 'x')));
  out.treeWritable = attempt(() => fs.writeFileSync('/work/project/canary-inside.txt', 'x'));
  out.scratchWritable = attempt(() => fs.writeFileSync('/work/scratch-only.txt', 'x'))
    && attempt(() => fs.writeFileSync('/tmp/scratch-only.txt', 'x'));
  out.symlinkCreated = attempt(() => fs.symlinkSync('/etc/passwd', '/work/project/escape-link'));
  out.networkRefused = await new Promise((resolve) => {
    const socket = net.connect({ host: '1.1.1.1', port: 443 });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(true));
    socket.setTimeout(2000, () => { socket.destroy(); resolve(true); });
  });
  out.dnsRefused = await dns.promises.lookup('example.com').then(() => false, () => true);
  process.stdout.write('CANARY:' + JSON.stringify(out) + '\\n');
})();
`;

interface ICanaryReport {
  readonly nonRoot: boolean;
  readonly environment: readonly { readonly name: string; readonly sha256: string }[];
  readonly hostPathHidden: boolean;
  readonly outsideWritesRefused: boolean;
  readonly treeWritable: boolean;
  readonly scratchWritable: boolean;
  readonly symlinkCreated: boolean;
  readonly networkRefused: boolean;
  readonly dnsRefused: boolean;
}

export interface IIsolationResult {
  /** Every check, by name; true means the isolation property holds. */
  readonly checks: Readonly<Record<string, boolean>>;
  readonly failures: readonly string[];
}

const CREDENTIAL_NAME = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;

/** Runs the canaries once in the worker's container configuration and checks the outcome on the host. */
export function runIsolationCanaries(options: {
  readonly image: string;
  readonly baseDir: string;
  readonly task: ICodingTask;
}): IIsolationResult {
  const trialDir = mkdtempSync(join(options.baseDir, '.coding-canary-'));
  const tree = join(trialDir, 'project');
  const hostFile = join(trialDir, 'host-only.txt');
  try {
    writeFileSync(hostFile, 'never mounted into the container');
    materializeWorkerTree(options.task, tree);
    const sentinel = `canary-${createHash('sha256').update(trialDir).digest('hex')}`;
    const args = buildWorkerContainerArgs({
      name: `robota-eval-canary-${createHash('sha256').update(trialDir).digest('hex').slice(0, 10)}`,
      image: options.image,
      root: tree,
      command: ['node', '-e', CANARY_SCRIPT, hostFile],
    }).filter((argument) => argument !== '-i');
    const run = spawnSync('docker', args, {
      encoding: 'utf8',
      timeout: 60_000,
      // The sentinel lives in the docker client's environment, as a credential would on the host.
      env: { ...process.env, [CANARY_ENV_NAME]: sentinel },
    });
    const line = run.stdout.split('\n').find((candidate) => candidate.startsWith('CANARY:'));
    if (line === undefined) {
      throw new Error(`The canary container reported nothing: ${run.stderr.slice(-800)}`);
    }
    const report = JSON.parse(line.slice('CANARY:'.length)) as ICanaryReport;
    const sentinelHash = createHash('sha256').update(sentinel).digest('hex');
    const observation = observeTree(options.task, tree, { exitCode: 0 });
    const checks: Record<string, boolean> = {
      'runs-as-non-root': report.nonRoot,
      'no-credential-like-environment-variable': !report.environment.some((entry) =>
        CREDENTIAL_NAME.test(entry.name),
      ),
      'host-credential-not-forwarded': !report.environment.some(
        (entry) => entry.sha256 === sentinelHash || entry.name === CANARY_ENV_NAME,
      ),
      'host-path-not-visible': report.hostPathHidden,
      'writes-outside-the-tree-refused': report.outsideWritesRefused,
      'tree-writable': report.treeWritable && existsSync(join(tree, 'canary-inside.txt')),
      'scratch-space-never-reaches-the-tree':
        report.scratchWritable && !existsSync(join(tree, 'scratch-only.txt')),
      'escaping-symlink-detected-by-observation':
        report.symlinkCreated &&
        !observation.noEscapes &&
        observation.escapes.includes('escape-link'),
      'network-refused': report.networkRefused,
      'name-resolution-refused': report.dnsRefused,
    };
    return {
      checks,
      failures: Object.entries(checks)
        .filter(([, held]) => !held)
        .map(([name]) => name),
    };
  } finally {
    rmSync(trialDir, { recursive: true, force: true });
  }
}
