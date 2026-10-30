import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { expect, it } from 'vitest';
import { createBuiltInBinaryEnvironment } from '../helpers/product-runtime.js';

it('starts an installed interactive CLI alongside a web UI using a newer React', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'robota-react-consumer-'));
  const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const candidate = join(temp, 'candidate');
  const consumer = join(temp, 'consumer');
  const home = join(temp, 'home');
  const workspace = join(temp, 'workspace');
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"fixture-model","choices":[{"index":0,"delta":{"role":"assistant","content":"REACT_TEST_OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      );
    });
  });
  let terminal: pty.IPty | undefined;
  try {
    for (const dir of [candidate, consumer, home, workspace]) mkdirSync(dir);
    cpSync(join(packageRoot, 'dist'), join(candidate, 'dist'), { recursive: true });
    cpSync(join(packageRoot, 'bin'), join(candidate, 'bin'), { recursive: true });
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    manifest.version = '0.0.0-react-identity-test';
    writeFileSync(join(candidate, 'package.json'), JSON.stringify(manifest));
    const packed = execFileSync(
      'npm',
      ['pack', candidate, '--pack-destination', temp, '--ignore-scripts', '--silent'],
      { encoding: 'utf8', timeout: 60_000 },
    ).trim();
    writeFileSync(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          '@robota-sdk/agent-cli': `file:${join(temp, packed)}`,
          '@robota-sdk/agent-ui-web': '3.0.2',
          react: '19.3.1',
          'react-dom': '19.3.1',
        },
      }),
    );
    const env = {
      ...createBuiltInBinaryEnvironment(home),
      HOME: home,
      USERPROFILE: home,
      TERM: 'xterm-256color',
      TEST_OPENAI_KEY: 'fixture-only',
    };
    await promisify(execFile)('npm', ['install', '--prefix', consumer, '--no-audit', '--no-fund'], {
      env,
      timeout: 90_000,
    });
    const cliRequire = createRequire(
      join(consumer, 'node_modules/@robota-sdk/agent-cli/package.json'),
    );
    const inkRequire = createRequire(cliRequire.resolve('ink'));
    expect(cliRequire('react') === inkRequire('react')).toBe(true);
    const webRequire = createRequire(join(consumer, 'package.json'));
    const react = webRequire('react');
    const { CenteredChrome, ProductIdentityProvider } = webRequire('@robota-sdk/agent-ui-web');
    const { renderToStaticMarkup } = webRequire('react-dom/server');
    const identity = {
      identity: { displayName: 'Test Product', cliName: 'test-product' },
      storage: { browserNamespace: 'test-product' },
    };
    expect(
      renderToStaticMarkup(
        react.createElement(
          ProductIdentityProvider,
          { value: identity },
          react.createElement(CenteredChrome, { tone: 'muted' }, 'WEB_OK'),
        ),
      ),
    ).toContain('WEB_OK');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('fixture server did not start');
    const cli = join(consumer, 'node_modules/@robota-sdk/agent-cli/bin/agent.cjs');
    execFileSync('git', ['init', '--quiet'], { cwd: workspace, env });
    execFileSync(process.execPath, [cli, 'trust', '--yes'], {
      cwd: workspace,
      env,
      timeout: 20_000,
    });
    execFileSync(
      process.execPath,
      [
        cli,
        '--configure-provider',
        'openai',
        '--type',
        'openai',
        '--model',
        'fixture-model',
        '--base-url',
        `http://127.0.0.1:${address.port}/v1`,
        '--api-key-env',
        'TEST_OPENAI_KEY',
        '--set-current',
        '--disable-update-check',
      ],
      { cwd: workspace, env, timeout: 20_000 },
    );
    let output = '';
    terminal = pty.spawn(process.execPath, [cli, '--disable-update-check'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 32,
      cwd: workspace,
      env,
    });
    terminal.onData((data) => {
      output += data;
    });
    const waitFor = async (marker: RegExp, offset = 0) => {
      const deadline = Date.now() + 20_000;
      while (!marker.test(output.slice(offset)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      expect(output.slice(offset)).toMatch(marker);
    };
    await waitFor(/Type a message or \/help/);
    terminal.write('Reply with the fixture marker');
    await new Promise((resolve) => setTimeout(resolve, 250));
    terminal.write('\r');
    await waitFor(/REACT_TEST_OK/);
    const slashOffset = output.length;
    terminal.write('/help');
    await new Promise((resolve) => setTimeout(resolve, 250));
    terminal.write('\r');
    await waitFor(/Commands|Available commands/i, slashOffset);
  } finally {
    terminal?.kill();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(temp, { recursive: true, force: true });
  }
}, 180_000);
