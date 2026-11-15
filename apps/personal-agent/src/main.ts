/**
 * `personal-agent` command line.
 *
 *   personal-agent configure --type <provider> --model <model> [--base-url <url>] [--api-key-env <VAR>]
 *   personal-agent env
 *   personal-agent start [--no-gui] [--server --public-url <https://host> [--gui-port N] [--ws-port N]]
 *   personal-agent access-code
 *
 * Every command takes `--state-dir <dir>`; without it the state directory comes from
 * `PERSONAL_AGENT_STATE_DIR` or defaults to `~/.robota/personal`.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { ensureStateDir, loadConfig, resolveStateDir, saveConfig } from './config.js';
import { startLocalMode } from './local-mode.js';
import { createProviderFromProfile } from './provider.js';
import { createPersonalCapabilities } from './capabilities.js';
import { ensureEnvFile, openInEditor, withEnvFile } from './env-file.js';
import {
  DEFAULT_GUI_PORT,
  DEFAULT_WS_PORT,
  parsePort,
  parsePublicOrigin,
  serverAccessCode,
} from './server-access.js';

const USAGE = `Usage:
  personal-agent configure --type <provider> --model <model> [--base-url <url>] [--api-key-env <VAR>]
  personal-agent env        open the owner-only .env for your provider key in your editor
  personal-agent start [--no-gui] [--gui-port 7360]
                            a fixed port for the web UI, for a sign-in redirect registered in advance
  personal-agent start --server --public-url https://agent.example.com [--gui-port 7360] [--ws-port 7361]
                            publish through a TLS reverse proxy on this host (see the guide)
  personal-agent access-code   print the published agent's access code
Options for every command: --state-dir <dir>`;

export async function main(
  argv: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'state-dir': { type: 'string' },
      type: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      'api-key-env': { type: 'string' },
      'no-gui': { type: 'boolean' },
      server: { type: 'boolean' },
      'public-url': { type: 'string' },
      'gui-port': { type: 'string' },
      'ws-port': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const command = positionals[0] ?? 'start';
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (
    command !== 'configure' &&
    command !== 'start' &&
    command !== 'env' &&
    command !== 'access-code'
  ) {
    process.stderr.write(`Unknown command "${command}"\n${USAGE}\n`);
    return 2;
  }
  const stateDir = resolveStateDir(values['state-dir'], environment);
  ensureStateDir(stateDir);

  if (command === 'access-code') {
    process.stdout.write(`${serverAccessCode(stateDir)}\n`);
    return 0;
  }
  if (command === 'env') {
    const path = ensureEnvFile(stateDir);
    process.stdout.write(`Opening ${path}\nPaste your key after "=" on its line and save.\n`);
    const status = await openInEditor(path, environment);
    if (status !== 0) process.stderr.write(`Could not open an editor; edit ${path} yourself.\n`);
    return 0;
  }
  // A key pasted into the state directory's .env counts as set; the process environment wins.
  const merged = withEnvFile(stateDir, environment);

  if (command === 'configure') {
    if (values.type === undefined || values.model === undefined) {
      process.stderr.write(`configure needs --type and --model\n${USAGE}\n`);
      return 2;
    }
    const provider = {
      type: values.type,
      model: values.model,
      ...(values['base-url'] !== undefined && { baseURL: values['base-url'] }),
      ...(values['api-key-env'] !== undefined && { apiKeyEnv: values['api-key-env'] }),
    };
    // Build it once so a profile that cannot work is refused here rather than at the first turn.
    createProviderFromProfile(provider, merged);
    saveConfig(stateDir, { ...loadConfig(stateDir), provider });
    process.stdout.write(`Provider saved to ${stateDir}\n`);
    return 0;
  }

  const config = loadConfig(stateDir);
  if (config.provider === undefined) {
    process.stderr.write('No provider is configured. Run `personal-agent configure` first.\n');
    return 2;
  }
  // Published: the public address, fixed loopback ports for the proxy, and the kept access code.
  const publicUrlSetting = values['public-url'] ?? merged['PERSONAL_AGENT_PUBLIC_URL'];
  const server =
    values.server === true
      ? {
          publicOrigin: parsePublicOrigin(
            publicUrlSetting ??
              ((): never => {
                throw new Error('--server needs --public-url (or PERSONAL_AGENT_PUBLIC_URL)');
              })(),
          ),
          guiPort: parsePort(values['gui-port'], DEFAULT_GUI_PORT, '--gui-port'),
          wsPort: parsePort(values['ws-port'], DEFAULT_WS_PORT, '--ws-port'),
          accessCode: serverAccessCode(stateDir),
        }
      : undefined;
  // Hosts the owner names (a service on their own network) may be reached although they are private.
  const connectorHosts = (merged['PERSONAL_AGENT_CONNECTOR_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host !== '');
  // The address of a hosted client metadata document naming this agent, for services that take one in place of a registration.
  const clientMetadataUrl = (merged['PERSONAL_AGENT_CLIENT_METADATA_URL'] ?? '').trim();
  if (
    clientMetadataUrl !== '' &&
    !(URL.canParse(clientMetadataUrl) && new URL(clientMetadataUrl).protocol === 'https:')
  ) {
    throw new Error('PERSONAL_AGENT_CLIENT_METADATA_URL must be an https address');
  }
  const capabilities = createPersonalCapabilities({
    stateDir,
    environment: merged,
    ...(connectorHosts.length > 0 && { connectorAllowedHosts: connectorHosts }),
    ...(clientMetadataUrl !== '' && { connectorClientMetadataUrl: clientMetadataUrl }),
  });
  const local = await startLocalMode({
    stateDir,
    provider: createProviderFromProfile(config.provider, merged),
    model: config.provider.model,
    tools: capabilities.tools,
    instructions: capabilities.instructions,
    gui: values['no-gui'] !== true,
    api: capabilities.api,
    landing: capabilities.landing,
    ...(server !== undefined && { server }),
    ...(server === undefined &&
      values['gui-port'] !== undefined && {
        guiPort: parsePort(values['gui-port'], 0, '--gui-port'),
      }),
  });
  // The addresses the person's browser reaches the page at: a sign-in with a service returns to one.
  const guiOrigins =
    local.gui === undefined
      ? []
      : [
          new URL(local.gui.url).origin,
          `http://localhost:${new URL(local.gui.url).port}`,
          ...(server !== undefined ? [new URL(server.publicOrigin).origin] : []),
        ];
  await capabilities.attach(local.agent, { guiOrigins });
  if (local.gui !== undefined && server !== undefined) {
    process.stdout.write(
      `Personal agent is published at ${server.publicOrigin} (loopback ${local.gui.url})\nAccess code: ${local.gui.accessCode}\n`,
    );
  } else if (local.gui !== undefined) {
    process.stdout.write(
      `Personal agent is open at ${local.gui.url}\nAccess code: ${local.gui.accessCode}\n`,
    );
  }
  process.stdout.write(`HTTP API at ${local.httpUrl} (bearer printed once): ${local.httpToken}\n`);
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await capabilities.dispose();
  await local.stop();
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
