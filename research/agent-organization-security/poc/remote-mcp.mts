/** Real CLI remote MCP gate and real local HTTPS/JWKS, using synthetic credentials only. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT } from '../../../packages/agent-transport/node_modules/jose/dist/webapi/index.js';
import { productEnvironment } from '../../../packages/product-config/src/__tests__/product-environment.ts';
import { createAccessTokenVerifier } from '../../../packages/agent-transport/src/node/access-token-verifier.ts';
const output = process.argv[2];
assert(output, 'Provide an output JSON path');
const records: { id: string; observed: unknown; passed: boolean }[] = [];
const record = async (id: string, observed: unknown, passed: boolean) => {
  records.push({ id, observed, passed });
  await writeFile(
    output,
    JSON.stringify(
      { kind: 'actual-cli-remote-mcp-local-https', records, complete: false },
      null,
      2,
    ) + '\n',
  );
  assert(passed, id);
};
if (process.argv[3] !== '--trusted-test-worker') {
  assert(
    process.platform !== 'win32',
    'This disposable process-group recipe requires Linux or macOS',
  );
  const directory = await mkdtemp(join(tmpdir(), 'issue-2-remote-mcp-'));
  try {
    const key = join(directory, 'tls.key');
    const cert = join(directory, 'tls.crt');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        key,
        '-out',
        cert,
      ],
      { stdio: 'ignore', env: { PATH: process.env.PATH, HOME: directory } },
    );
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        output,
        '--trusted-test-worker',
        directory,
      ],
      {
        env: { PATH: process.env.PATH, HOME: directory, NODE_EXTRA_CA_CERTS: cert },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    let diagnostics = '';
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    const exited = once(child, 'exit');
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null && child.pid)
        process.kill(-child.pid, 'SIGKILL');
    }, 45000);
    let code;
    try {
      [code] = await exited;
    } finally {
      clearTimeout(timer);
    }
    assert(code === 0, 'Remote MCP probe failed; raw diagnostics withheld');
    assert(
      !diagnostics.includes('BEGIN PRIVATE KEY'),
      'TLS private material appeared in diagnostics',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  const directory = process.argv[4];
  const tls = {
    key: await readFile(join(directory, 'tls.key')),
    cert: await readFile(join(directory, 'tls.crt')),
  };
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const wrongSigner = generateKeyPairSync('ed25519').privateKey;
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'synthetic-key',
    alg: 'EdDSA',
    use: 'sig',
  };
  let issuer = '';
  let mode: 'healthy' | 'outage' | 'redirect' = 'healthy';
  let requests = 0;
  let redirected = 0;
  const https = createServer(tls, (req, res) => {
    requests++;
    if (req.url === '/redirect-target') redirected++;
    if (mode === 'outage') {
      res.writeHead(503).end();
      return;
    }
    if (mode === 'redirect') {
      res.writeHead(302, { location: issuer + '/redirect-target' }).end();
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/jwks' ? { keys: [jwk] } : { issuer, jwks_uri: issuer + '/jwks' },
      ),
    );
  });
  https.listen(0, '127.0.0.1');
  await once(https, 'listening');
  const address = https.address();
  assert(address && typeof address !== 'string');
  issuer = `https://127.0.0.1:${address.port}`;
  const resource = 'https://research.example.invalid/task/mcp';
  const config = join(directory, 'product.env');
  const env = {
    ...productEnvironment('research-agent'),
    PRODUCT_ENV_PREFIX: 'RESEARCH_AGENT_',
    PRODUCT_MODEL_TOOL_PREFIX: 'research_agent_command_',
    PRODUCT_USER_STATE_DIR: join(directory, 'state'),
    PRODUCT_CACHE_DIR: join(directory, 'cache'),
    PRODUCT_LOG_DIR: join(directory, 'logs'),
  };
  await writeFile(
    config,
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
  );
  const cwd = join(directory, 'workspace');
  await mkdir(cwd);
  const cli = fileURLToPath(
    new URL('../../../packages/agent-cli/dist/node/bin.js', import.meta.url),
  );
  const cliEnv = {
    PATH: process.env.PATH,
    HOME: directory,
    PRODUCT_CONFIG_FILE: config,
    PRODUCT_USER_STATE_DIR: env.PRODUCT_USER_STATE_DIR,
    NODE_EXTRA_CA_CERTS: join(directory, 'tls.crt'),
    RESEARCH_FAKE_MODEL_KEY: 'synthetic-non-secret',
  };
  execFileSync(
    process.execPath,
    [
      cli,
      '--configure-provider',
      'fixture',
      '--type',
      'openai',
      '--base-url',
      'http://127.0.0.1:1/v1',
      '--model',
      'synthetic',
      '--api-key-env',
      'RESEARCH_FAKE_MODEL_KEY',
      '--set-current',
    ],
    { cwd, env: cliEnv, stdio: 'ignore' },
  );
  const tokens: string[] = [];
  const mint = async (
    options: {
      audience?: string;
      scope?: string;
      subject?: string;
      expired?: boolean;
      wrongKey?: boolean;
    } = {},
  ) => {
    const token = await new SignJWT({
      client_id: 'synthetic-client',
      scope: options.scope ?? 'mcp:use',
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid: 'synthetic-key' })
      .setIssuer(issuer)
      .setAudience(options.audience ?? resource)
      .setSubject(options.subject ?? 'actor-a')
      .setExpirationTime(Math.floor(Date.now() / 1000) + (options.expired ? -120 : 300))
      .sign(options.wrongKey ? wrongSigner : privateKey);
    tokens.push(token);
    return token;
  };
  let diagnostics = '';
  let stdout = '';
  const child = spawn(
    process.execPath,
    [
      cli,
      'mcp',
      'serve',
      '--http-public-url',
      resource,
      '--oauth-issuer',
      issuer,
      '--oauth-scopes',
      'mcp:use',
      '--oauth-allowed-subjects',
      'actor-a',
      '--allowed-tools',
      'Read',
      '--no-session-persistence',
    ],
    { cwd, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stderr.on('data', (data) => {
    diagnostics += data.toString();
  });
  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  const exit = once(child, 'exit');
  try {
    const deadline = performance.now() + 15000;
    while (!/listening on 127\.0\.0\.1:\d+/.test(diagnostics)) {
      assert(
        child.exitCode === null && performance.now() < deadline,
        'Owned remote MCP CLI did not start',
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const port = Number(diagnostics.match(/listening on 127\.0\.0\.1:(\d+)/)?.[1]);
    const call = (token?: string, host = 'research.example.invalid', path = '/task/mcp') =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: {
              Host: host,
              Accept: 'application/json, text/event-stream',
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk.toString();
            });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.setTimeout(15000, () => req.destroy(new Error('Owned HTTP request timeout')));
        req.on('error', reject);
        req.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'synthetic-research', version: '1' },
            },
          }),
        );
      });
    const good = await mint();
    const admitted = await call(good);
    await record(
      'actual-cli-valid-jwt-initialize',
      {
        status: admitted.status,
        issuerRequests: requests,
        protocolResponse: admitted.body.includes('protocolVersion'),
      },
      admitted.status === 200 && requests >= 2 && admitted.body.includes('protocolVersion'),
    );
    for (const [id, token, expected] of [
      ['missing-token', undefined, 401],
      ['wrong-audience', await mint({ audience: resource + '/other' }), 401],
      ['missing-scope', await mint({ scope: 'other:scope' }), 403],
      ['wrong-subject', await mint({ subject: 'actor-b' }), 401],
      ['bad-signature', await mint({ wrongKey: true }), 401],
      ['expired-token', await mint({ expired: true }), 401],
    ] as const) {
      const response = await call(token);
      await record(
        id,
        { status: response.status, responseBodyEmpty: response.body === '' },
        response.status === expected && response.body === '',
      );
    }
    const wrongHost = await call(good, 'untrusted.example.invalid');
    await record('host-header-refused', { status: wrongHost.status }, wrongHost.status === 403);
    // New verifier uses real HTTPS and cold keys; the failed issuer cannot borrow the CLI's cache.
    const config = {
      issuer,
      resource,
      algorithms: ['EdDSA'] as const,
      requiredScopes: ['mcp:use'],
      allowedSubjects: ['actor-a'],
    };
    mode = 'outage';
    const cold = await createAccessTokenVerifier(config).verify(good);
    await record('cold-issuer-outage', cold, !cold.admitted && cold.refusal === 'keys-unavailable');
    // Cached keys remain admitted before the product's hard-age bound. This is deliberate availability policy.
    const warm = await call(good);
    await record('cli-young-cache-during-outage', { status: warm.status }, warm.status === 200);
    mode = 'healthy';
    let clock = 0;
    const verifier = createAccessTokenVerifier(config, { monotonicNow: () => clock });
    assert((await verifier.verify(good)).admitted, 'Fresh TLS verifier positive control failed');
    mode = 'outage';
    clock = 60 * 60 * 1000;
    const stale = await verifier.verify(good);
    await record(
      'hard-cache-age-with-real-https-outage',
      stale,
      !stale.admitted && stale.refusal === 'keys-unavailable',
    );
    mode = 'redirect';
    const redirectedVerdict = await createAccessTokenVerifier(config).verify(good);
    await record(
      'issuer-redirect-not-followed',
      { verdict: redirectedVerdict, redirectTargetRequests: redirected },
      !redirectedVerdict.admitted &&
        redirectedVerdict.refusal === 'keys-unavailable' &&
        redirected === 0,
    );
    assert(
      tokens.every((token) => !diagnostics.includes(token)) && stdout === '',
      'CLI emitted bearer text or protocol data to stdout',
    );
    await record(
      'token-and-protocol-output-hygiene',
      { tokenAbsent: true, stdoutEmpty: true },
      true,
    );
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    try {
      await Promise.race([
        exit,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Owned CLI shutdown timeout')), 5000),
        ),
      ]);
    } catch {
      child.kill('SIGKILL');
      await exit;
    }
    https.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      https.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await record(
    'owned-cli-and-issuer-stopped',
    {
      cliExited: child.exitCode !== null || child.signalCode !== null,
      issuerStopped: !https.listening,
    },
    (child.exitCode !== null || child.signalCode !== null) && !https.listening,
  );
  await writeFile(
    output,
    JSON.stringify(
      {
        kind: 'actual-cli-remote-mcp-local-https',
        records,
        complete: true,
        limitations: [
          'HTTPS issuer/JWKS and bearer crypto are real; public resource URL is a synthetic Host header over an owned loopback HTTP listener, not a remote deployment.',
          'Only the standalone verifier hard-cache-age observation advances its monotonic dependency; it does not wait an hour or change the CLI clock.',
          'No Electron remote pairing, trusted proxy deployment, provider authentication or cloud egress is proven.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(`${records.length} actual remote MCP/HTTPS observations passed\n`);
}
