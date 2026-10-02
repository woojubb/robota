import { _electron as electron } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildProductTestEnvironment } from './product-fixture.mjs';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Run the real window/main/preload against the stock-worker TLS fixture supplied by the CLI test. */
export async function exerciseDesktopRemote({
  directory,
  publicUrl,
  binding,
  jwt,
  operatorJwt,
  session,
  requestTool,
}) {
  const credentialFile = join(directory, 'native-credential');
  const operatorCredentialFile = join(directory, 'native-operator');
  const configFile = join(directory, 'native-config');
  writeFileSync(credentialFile, jwt, { mode: 0o600 });
  writeFileSync(operatorCredentialFile, operatorJwt, { mode: 0o600 });
  writeFileSync(
    configFile,
    JSON.stringify({
      version: 1,
      publicUrl,
      binding,
      credentialFile,
      operatorCredentialFile,
      caFile: join(directory, 'cert.pem'),
    }),
    { mode: 0o600 },
  );
  const inherited = Object.fromEntries(
    [
      'PATH',
      'DISPLAY',
      'XAUTHORITY',
      'XDG_RUNTIME_DIR',
      'DBUS_SESSION_BUS_ADDRESS',
      'SystemRoot',
      'LANG',
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  const product = buildProductTestEnvironment(join(directory, 'native-product'));
  const application = await electron.launch({
    executablePath: process.env.PRODUCT_DESKTOP_NATIVE_E2E_EXECUTABLE,
    args: ['--no-sandbox', '--disable-gpu', join(appRoot, 'dist/electron/main.js')],
    env: {
      ...inherited,
      ...product.environment,
      HOME: join(directory, 'native-home'),
      PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG: configFile,
    },
  });
  try {
    const page = await application.firstWindow();
    await page.locator('.agent-gui-status[data-status="connected"]').waitFor({ timeout: 20_000 });
    const bridge = await page.evaluate(async () => ({
      mode: window.agentGui.runtimeMode,
      endpoint: await window.agentGui.getEndpoint(),
      trust: await window.agentGui.trustQuestion(),
      files: await window.agentGui.pickFiles(),
      path: window.agentGui.getPathForFile(new File(['x'], 'local.txt')),
      open: await window.agentGui.openPath('/local/file'),
    }));
    if (
      bridge.mode !== 'remote' ||
      bridge.trust !== null ||
      bridge.files.length ||
      bridge.path ||
      !bridge.open.error ||
      !bridge.endpoint.startsWith('ws://127.0.0.1:') ||
      bridge.endpoint.includes(jwt)
    )
      throw new Error('Remote/local capability separation failed');
    await application.evaluate(({ dialog }) => {
      globalThis.remoteApprovalCount = 0;
      dialog.showMessageBox = async (options) => {
        if (
          options.message !== 'Remote task requests permission' ||
          options.defaultId !== 0 ||
          options.buttons.join(',') !== 'Deny,Allow once'
        )
          throw new Error('Untrusted approval presentation');
        globalThis.remoteApprovalCount++;
        return { response: 1, checkboxChecked: false };
      };
    });
    requestTool();
    await page.getByLabel('message').fill('Write through the native owner approval');
    await page.getByLabel('message').press('Enter');
    await page.getByText('REMOTE_DESKTOP_RESPONSE').first().waitFor({ timeout: 15_000 });
    const deadline = Date.now() + 10_000;
    let approvals = 0;
    while (approvals === 0 && Date.now() < deadline) {
      approvals = await application.evaluate(() => globalThis.remoteApprovalCount);
      if (!approvals) await new Promise((done) => setTimeout(done, 100));
    }
    if (approvals !== 1) throw new Error(`Expected one native approval, observed ${approvals}`);
    if ((await page.content()).includes(jwt) || (await page.content()).includes(operatorJwt))
      throw new Error('Credential exposed in renderer');
    process.stdout.write(
      `Native remote desktop connected to pinned session ${session} and approved the operation once.\n`,
    );
  } finally {
    const closed = application.waitForEvent('close', { timeout: 10_000 });
    await application.evaluate(({ app }) => {
      setImmediate(() => app.quit());
    });
    await closed;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const executable =
    process.env.PRODUCT_DESKTOP_NATIVE_E2E_EXECUTABLE ??
    createRequire(join(appRoot, 'package.json'))('electron');
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@robota-sdk/agent-cli',
      'exec',
      'vitest',
      'run',
      'src/hosted/__tests__/desktop-gateway.integration.test.ts',
    ],
    {
      cwd: join(appRoot, '../..'),
      stdio: 'inherit',
      env: { ...process.env, PRODUCT_DESKTOP_NATIVE_E2E_EXECUTABLE: executable },
    },
  );
  process.exitCode = result.status ?? 1;
}
