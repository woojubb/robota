import { createConnection } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getProviderSettingsPaths, readProviderSettings } from '@robota-sdk/agent-framework';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';

import type { IProviderDefinition, ITerminalOutput } from '@robota-sdk/agent-core';

const PROVIDER_ENDPOINTS: Record<string, { host: string; port: number }> = {
  anthropic: { host: 'api.anthropic.com', port: 443 },
  openai: { host: 'api.openai.com', port: 443 },
  gemini: { host: 'generativelanguage.googleapis.com', port: 443 },
  deepseek: { host: 'api.deepseek.com', port: 443 },
  qwen: { host: 'dashscope.aliyuncs.com', port: 443 },
};

export interface IDiagnoseContext {
  version: string;
  terminal: ITerminalOutput;
  cwd: string;
}

export interface IDiagnosticCheck {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

export interface IDiagnoseDependencies {
  checkNetwork: (endpoint: { host: string; port: number }) => Promise<IDiagnosticCheck>;
  /** Environment map for provider resolution (test seam, default: process.env). */
  env?: Record<string, string | undefined>;
  /** Provider definitions for resolution (default: the CLI's default set). */
  providerDefinitions?: readonly IProviderDefinition[];
}

function checkNodeVersion(): IDiagnosticCheck {
  const [major] = process.versions.node.split('.').map(Number);
  if (major !== undefined && major >= 22) {
    return { label: 'Node.js version', status: 'ok', message: `v${process.versions.node}` };
  }
  return {
    label: 'Node.js version',
    status: 'fail',
    message: `v${process.versions.node} (requires >=22)\n  nvm:   nvm install 22 && nvm use 22\n  Volta: volta install node@22`,
  };
}

function checkCliVersion(version: string): IDiagnosticCheck {
  return { label: 'robota version', status: 'ok', message: version };
}

/**
 * CLI-067: the API-key check IS the runtime resolution — settings profiles
 * (with `$ENV:` references) first, then env-default synthesis (CLI-066).
 * Diagnose can never disagree with session start again. Never prints key values.
 */
function checkApiKeyResolution(
  cwd: string,
  providerDefinitions: readonly IProviderDefinition[],
  env: Record<string, string | undefined>,
): IDiagnosticCheck {
  try {
    const config = readProviderSettings(cwd, { providerDefinitions, env });
    const source =
      config.source === 'env-default'
        ? `env-default via ${config.sourceEnvVar ?? 'environment'}`
        : 'settings profile';
    const model = config.model !== undefined ? ` (${config.model})` : '';
    return { label: 'API key', status: 'ok', message: `${config.name}${model} — ${source}` };
  } catch (error) {
    // allow-fallback: resolution failure is the diagnostic finding being reported, not a crash
    const message = error instanceof Error ? error.message : String(error);
    return {
      label: 'API key',
      status: 'fail',
      message: `${message}\n  Set ANTHROPIC_API_KEY or run: robota --configure\n  Get key: https://console.anthropic.com/settings/keys`,
    };
  }
}

function validateJsonFile(filePath: string): 'ok' | 'corrupt' {
  try {
    JSON.parse(readFileSync(filePath, 'utf-8'));
    return 'ok';
  } catch {
    // allow-fallback: corrupt JSON → reported as diagnostic finding, not a crash
    return 'corrupt';
  }
}

/**
 * CLI-067: every settings file the runtime merge chain reads is validated
 * independently — a corrupt user-level file is flagged even when a valid
 * project file exists. Missing files are not an issue (the API-key check
 * reports actual resolution failures).
 */
function checkSettingsFiles(cwd: string): IDiagnosticCheck[] {
  const existing = getProviderSettingsPaths(cwd).filter((path) => existsSync(path));
  if (existing.length === 0) {
    return [
      {
        label: 'Settings file',
        status: 'warn',
        message: 'Not found — run: robota --configure',
      },
    ];
  }
  return existing.map((path) =>
    validateJsonFile(path) === 'corrupt'
      ? {
          label: 'Settings file',
          status: 'fail' as const,
          message: `${path} — invalid JSON\n  Fix or delete the file, or run: robota --configure`,
        }
      : { label: 'Settings file', status: 'ok' as const, message: path },
  );
}

function tryReadCurrentProvider(settingsPath: string): string | undefined {
  try {
    const doc = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { currentProvider?: string };
    return typeof doc.currentProvider === 'string' ? doc.currentProvider : undefined;
  } catch {
    // allow-fallback: unreadable settings for network check → caller uses default endpoint
    return undefined;
  }
}

function resolveNetworkEndpoint(cwd: string): { host: string; port: number } {
  const settingsPath = join(cwd, '.robota', 'settings.json');
  const homeSettings = join(process.env['HOME'] ?? '', '.robota', 'settings.json');
  const activePath = existsSync(settingsPath)
    ? settingsPath
    : existsSync(homeSettings)
      ? homeSettings
      : undefined;
  if (activePath !== undefined) {
    const providerKey = (tryReadCurrentProvider(activePath) ?? '').toLowerCase();
    const match = Object.entries(PROVIDER_ENDPOINTS).find(([key]) => providerKey.startsWith(key));
    if (match) return match[1];
  }
  return PROVIDER_ENDPOINTS['anthropic']!;
}

function checkTerminal(): IDiagnosticCheck {
  const term = process.env['TERM_PROGRAM'] ?? 'unknown';
  if (process.platform === 'darwin' && term === 'Apple_Terminal') {
    return {
      label: 'Terminal',
      status: 'warn',
      message: `macOS Terminal.app — CJK/IME input may be unstable\n  Recommendation: use iTerm2 (https://iterm2.com)`,
    };
  }
  return { label: 'Terminal', status: 'ok', message: term };
}

function checkNetworkViaSocket(endpoint: {
  host: string;
  port: number;
}): Promise<IDiagnosticCheck> {
  const label = `Network (${endpoint.host})`;
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = createConnection({ host: endpoint.host, port: endpoint.port });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ label, status: 'fail', message: 'timeout (3s)' });
    }, 3000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({ label, status: 'ok', message: `reachable (${Date.now() - start}ms)` });
    });
    socket.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        label,
        status: 'warn',
        message: `${err.message}\n  Check proxy settings or firewall`,
      });
    });
  });
}

/**
 * Runs every diagnostic check and returns the number of failed checks —
 * the exit-code contract (CLI-067) is 0 when the count is 0, otherwise 1.
 */
export async function runDiagnoseCommand(
  ctx: IDiagnoseContext,
  deps: IDiagnoseDependencies = { checkNetwork: checkNetworkViaSocket },
): Promise<number> {
  ctx.terminal.writeLine('\nrobota diagnose\n');

  const networkEndpoint = resolveNetworkEndpoint(ctx.cwd);
  const providerDefinitions = deps.providerDefinitions ?? createDefaultProviderDefinitions();
  const env = deps.env ?? process.env;

  const checks: IDiagnosticCheck[] = [
    checkNodeVersion(),
    checkCliVersion(ctx.version),
    checkApiKeyResolution(ctx.cwd, providerDefinitions, env),
    ...checkSettingsFiles(ctx.cwd),
    checkTerminal(),
    await deps.checkNetwork(networkEndpoint),
  ];

  let failCount = 0;
  let warnCount = 0;

  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    const lines = check.message.split('\n');
    ctx.terminal.writeLine(`  ${icon} ${check.label}: ${lines[0]}`);
    for (const line of lines.slice(1)) {
      ctx.terminal.writeLine(`    ${line}`);
    }
    if (check.status === 'fail') failCount++;
    if (check.status === 'warn') warnCount++;
  }

  ctx.terminal.writeLine('');
  if (failCount === 0 && warnCount === 0) {
    ctx.terminal.writeLine('✓ All checks passed. robota is ready to use.');
  } else if (failCount > 0) {
    ctx.terminal.writeLine(`✗ ${failCount} issue(s) found. Fix the items above to use robota.`);
  } else {
    ctx.terminal.writeLine(`⚠ ${warnCount} warning(s). robota may work but check the items above.`);
  }
  ctx.terminal.writeLine('');
  return failCount;
}
