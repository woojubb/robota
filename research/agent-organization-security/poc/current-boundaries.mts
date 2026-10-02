/** Observational research probe: real product implementations, synthetic canaries only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  OsSandboxClient,
  detectOsSandbox,
} from '../../../packages/agent-tools/src/sandbox/os-sandbox-client.ts';
import { createDefaultTools } from '../../../packages/agent-tool-defaults/src/create-default-tools.ts';
import { restoreProjectedSandbox } from '../../../packages/agent-subagent-runner/src/worker-composition.ts';

const started = performance.now();
const output = process.argv[2];
assert(
  output,
  'Usage: pnpm exec tsx research/agent-organization-security/poc/current-boundaries.mts <report.json>',
);
const parent = await mkdtemp(join(dirname(process.cwd()), 'issue-2-canaries-'));
const temp = await mkdtemp(join(tmpdir(), 'issue-2-canaries-'));
const workspace = join(parent, 'task-a');
const outside = join(parent, 'runtime-canary');
const sibling = join(temp, 'task-b-canary');
const token = `synthetic-${randomUUID()}`;
const records: { id: string; observation: string; verified: boolean }[] = [];
const record = (id: string, observation: string, verified: boolean) => {
  records.push({ id, observation, verified });
  assert(verified, `${id}: observed result differs from the recorded observation`);
};
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
await mkdir(workspace);
await mkdir(join(workspace, '.git'));
await writeFile(join(workspace, '.git', 'config'), 'canary');
await writeFile(outside, token, { mode: 0o600 });
await writeFile(sibling, 'other-task');
const availability = detectOsSandbox();
assert(
  availability.executable && availability.backend === 'bubblewrap',
  'Linux bubblewrap must work; no fallback',
);
const client = (settings = {}, backend = availability) =>
  new OsSandboxClient({
    root: workspace,
    availability: backend,
    settings,
    projectStateDirectory: '.research-state',
    userQuarantineDirectory: join(parent, 'quarantine'),
  });
const server = createServer((_, res) => res.end('synthetic-network-canary'));
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
try {
  const disabled = client();
  const defaultWrite = await disabled.run(`printf default > ${quote(outside)}`);
  record(
    'default-disabled',
    'admitted shell runs on host',
    defaultWrite.exitCode === 0 && !disabled.status().active,
  );
  await writeFile(outside, token);
  const active = client({ enabled: true });
  const read = await active.run(`cat ${quote(outside)}`);
  record(
    'runtime-file-readable',
    'confined shell can read synthetic runtime file outside workspace',
    read.stdout === token,
  );
  process.env.RESEARCH_SYNTHETIC_KEY = token;
  const env = await active.run('printf %s "$RESEARCH_SYNTHETIC_KEY"');
  delete process.env.RESEARCH_SYNTHETIC_KEY;
  record(
    'runtime-env-inherited',
    'confined shell inherits synthetic runtime environment value',
    env.stdout === token,
  );
  const ownWrite = await active.run('printf own > ordinary.txt');
  record('workspace-write', 'ordinary workspace write allowed', ownWrite.exitCode === 0);
  const protectedWrite = await active.run('printf tamper > .git/config');
  record(
    'git-config-write',
    'existing .git write refused',
    protectedWrite.exitCode !== 0 &&
      (await readFile(join(workspace, '.git', 'config'), 'utf8')) === 'canary',
  );
  const outsideWrite = await active.run(`printf tamper > ${quote(outside)}`);
  record(
    'outside-write',
    'non-temp host write refused',
    outsideWrite.exitCode !== 0 && (await readFile(outside, 'utf8')) === token,
  );
  const tempWrite = await active.run(`printf tamper > ${quote(sibling)}`);
  record(
    'shared-temp-write',
    'other synthetic task file under shared temp remains writable',
    tempWrite.exitCode === 0 && (await readFile(sibling, 'utf8')) === 'tamper',
  );
  const hidden = client({ enabled: true, denyRead: [outside] });
  const hiddenRead = await hidden.run(`cat ${quote(outside)}`);
  record(
    'deny-read-mask',
    'explicit file denyRead prevents canary disclosure',
    !hiddenRead.stdout.includes(token),
  );
  const missing = client(
    { enabled: true },
    { backend: 'bubblewrap' as const, missing: ['synthetic missing executable'] },
  );
  const missingRun = await missing.run(`printf missing > ${quote(outside)}`);
  record(
    'backend-missing',
    'OsSandboxClient alone runs admitted command unconfined when unavailable; startup policy must reject',
    missingRun.exitCode === 0 && !missing.status().active,
  );
  const excluded = client({ enabled: true, excludedCommands: ['printf'] });
  const excludedRun = await excluded.run(`printf excluded > ${quote(outside)}`);
  record(
    'excluded-command',
    'excluded first program runs admitted command unconfined',
    excludedRun.exitCode === 0 && !excluded.confines('printf excluded'),
  );
  const failing = client(
    { enabled: true },
    { backend: 'bubblewrap' as const, executable: '/usr/bin/false', missing: [] },
  );
  const failRun = await failing.run(`printf fallback > ${quote(outside)}`);
  record(
    'backend-execution-failure',
    'backend exit failure does not retry shell on host',
    failRun.exitCode !== 0 && (await readFile(outside, 'utf8')) === 'excluded',
  );
  const port = (server.address() as { port: number }).port;
  const probe = `import socket,json,sys\ntry:\n with socket.create_connection(('127.0.0.1', ${port}), 1) as s:\n  s.sendall(b'GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n')\n  data=s.makefile('rb').read().decode()\n  print(json.dumps({'connected':True,'canary':'synthetic-network-canary' in data}))\nexcept OSError as e:\n print(json.dumps({'connected':False,'errno':e.errno}))\n sys.exit(81)`;
  // Async spawn avoids blocking the event loop that serves the positive-control HTTP request.
  const { execFile } = await import('node:child_process');
  const hostProbe = await new Promise<string>((done, reject) =>
    execFile('python3', ['-c', probe], { timeout: 5000 }, (error, stdout) =>
      error ? reject(error) : done(stdout),
    ),
  );
  record(
    'network-host-positive',
    'host Python probe receives the synthetic loopback canary',
    JSON.parse(hostProbe).canary === true,
  );
  const enabledNet = await client({ enabled: true, network: true }).run(
    `python3 -c ${quote(probe)}`,
  );
  record(
    'network-enabled-positive',
    'same confined command with network enabled receives canary',
    enabledNet.exitCode === 0 && JSON.parse(enabledNet.stdout).canary === true,
  );
  const net = await active.run(`python3 -c ${quote(probe)}`);
  const netResult = JSON.parse(net.stdout);
  record(
    'network-disabled',
    'same confined command reports a network refusal rather than an arbitrary program failure',
    net.exitCode === 81 &&
      netResult.connected === false &&
      [1, 13, 101, 111].includes(netResult.errno),
  );
  await writeFile(outside, token);
  const tool = createDefaultTools({ cwd: workspace, sandboxClient: active }).find(
    (item) => item.getName() === 'Read',
  )!;
  const parameters = { filePath: outside };
  const result = await tool.execute(parameters, { toolName: 'Read', parameters });
  record(
    'file-tool-root',
    'production default-tools composition keeps shared-sandbox Read on root-guarded host path',
    !String(result.data).includes(token) && String(result.data).includes('false'),
  );
  let refused = false;
  try {
    await restoreProjectedSandbox({ type: 'missing', snapshotId: 'synthetic' }, {});
  } catch {
    refused = true;
  }
  record(
    'worker-restore-missing',
    'projected subagent with unregistered sandbox type refuses restoration',
    refused,
  );
  const report = {
    schema: 1,
    kind: 'current-product-boundary-observations',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    platform: process.platform,
    backend: availability.backend,
    durationMs: Math.round(performance.now() - started),
    limitations: [
      'Admitted tools are exercised directly; this is not a model-prompt exploit or cloud-provider PoC.',
      'No real credentials, accounts, repositories or external services are used.',
      'No microVM isolation claim follows from namespace-only tests.',
    ],
    records,
  };
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(
    `${records.length} recorded observations verified; report written without canary values\n`,
  );
} finally {
  delete process.env.RESEARCH_SYNTHETIC_KEY;
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  await rm(parent, { recursive: true, force: true });
  await rm(temp, { recursive: true, force: true });
}
