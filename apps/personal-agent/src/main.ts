/**
 * `personal-agent` command line.
 *
 *   personal-agent configure --type <provider> --model <model> [--base-url <url>] [--api-key-env <VAR>]
 *   personal-agent env
 *   personal-agent start [--no-gui]
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

const USAGE = `Usage:
  personal-agent configure --type <provider> --model <model> [--base-url <url>] [--api-key-env <VAR>]
  personal-agent env        open the owner-only .env for your provider key in your editor
  personal-agent start [--no-gui]
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
      help: { type: 'boolean' },
    },
  });
  const command = positionals[0] ?? 'start';
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (command !== 'configure' && command !== 'start' && command !== 'env') {
    process.stderr.write(`Unknown command "${command}"\n${USAGE}\n`);
    return 2;
  }
  const stateDir = resolveStateDir(values['state-dir'], environment);
  ensureStateDir(stateDir);

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
  const capabilities = createPersonalCapabilities({ stateDir, environment: merged });
  const local = await startLocalMode({
    stateDir,
    provider: createProviderFromProfile(config.provider, merged),
    model: config.provider.model,
    tools: capabilities.tools,
    instructions: capabilities.instructions,
    gui: values['no-gui'] !== true,
    api: capabilities.api,
  });
  await capabilities.attach(local.agent);
  if (local.gui !== undefined) {
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
