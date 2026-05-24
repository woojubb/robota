import { createConnection } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IPreflightContext } from './preflight.js';

interface IDiagnosticCheck {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

function checkNodeVersion(): IDiagnosticCheck {
  const [major] = process.versions.node.split('.').map(Number);
  if (major >= 22) {
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

function checkApiKey(): IDiagnosticCheck {
  const keys = [
    { env: 'ANTHROPIC_API_KEY', label: 'Anthropic' },
    { env: 'OPENAI_API_KEY', label: 'OpenAI' },
    { env: 'GEMINI_API_KEY', label: 'Gemini' },
    { env: 'DEEPSEEK_API_KEY', label: 'DeepSeek' },
  ];
  const found = keys.filter((k) => process.env[k.env]);
  if (found.length > 0) {
    return { label: 'API key', status: 'ok', message: found.map((k) => k.label).join(', ') };
  }
  return {
    label: 'API key',
    status: 'fail',
    message:
      'No API key found\n  Set ANTHROPIC_API_KEY or run: robota configure\n  Get key: https://console.anthropic.com/settings/keys',
  };
}

function checkSettingsFile(cwd: string): IDiagnosticCheck {
  const settingsPath = join(cwd, '.robota', 'settings.json');
  const homeSettings = join(process.env.HOME ?? '', '.robota', 'settings.json');
  if (existsSync(settingsPath)) {
    return { label: 'Settings file', status: 'ok', message: settingsPath };
  }
  if (existsSync(homeSettings)) {
    return { label: 'Settings file', status: 'ok', message: `${homeSettings} (global)` };
  }
  return {
    label: 'Settings file',
    status: 'warn',
    message: 'Not found — run: robota configure',
  };
}

function checkTerminal(): IDiagnosticCheck {
  const term = process.env.TERM_PROGRAM ?? 'unknown';
  if (process.platform === 'darwin' && term === 'Apple_Terminal') {
    return {
      label: 'Terminal',
      status: 'warn',
      message: `macOS Terminal.app — CJK/IME input may be unstable\n  Recommendation: use iTerm2 (https://iterm2.com)`,
    };
  }
  return { label: 'Terminal', status: 'ok', message: term };
}

async function checkNetwork(): Promise<IDiagnosticCheck> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = createConnection({ host: 'api.anthropic.com', port: 443 });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ label: 'Network (api.anthropic.com)', status: 'fail', message: 'timeout (3s)' });
    }, 3000);
    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve({
        label: 'Network (api.anthropic.com)',
        status: 'ok',
        message: `reachable (${Date.now() - start}ms)`,
      });
    });
    socket.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        label: 'Network (api.anthropic.com)',
        status: 'warn',
        message: `${err.message}\n  Check proxy settings or firewall`,
      });
    });
  });
}

function readCliVersionFromPackageJson(): string {
  try {
    // allow-fallback: package.json read failure is non-fatal for diagnose display
    const pkgPath = new URL('../../../package.json', import.meta.url).pathname;
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    // allow-fallback: version read is best-effort
    return 'unknown';
  }
}

export async function runDiagnoseCommand(ctx: IPreflightContext): Promise<void> {
  const versionDisplay = ctx.version === 'unknown' ? readCliVersionFromPackageJson() : ctx.version;
  ctx.terminal.writeLine('\nrobota --diagnose\n');

  const checks: IDiagnosticCheck[] = [
    checkNodeVersion(),
    checkCliVersion(versionDisplay),
    checkApiKey(),
    checkSettingsFile(ctx.cwd),
    checkTerminal(),
    await checkNetwork(),
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
    ctx.terminal.writeLine(
      `⚠ ${warnCount} warning(s). robota may work but check the items above.`,
    );
  }
  ctx.terminal.writeLine('');
}
